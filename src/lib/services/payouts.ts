import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

async function requireAdmin(ctx: ServiceContext): Promise<ServiceResult<never> | null> {
  const { data } = await ctx.admin
    .from('profiles').select('role').eq('id', ctx.user.id).maybeSingle();
  if (data?.role !== 'admin') return fail('forbidden', 'Forbidden');
  return null;
}

export async function createPayoutBatch(
  ctx: ServiceContext,
): Promise<ServiceResult<{ redirect: string }>> {
  const denied = await requireAdmin(ctx);
  if (denied) return denied;

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const { count: existing } = await ctx.admin
    .from('moderator_payouts').select('id', { count: 'exact', head: true }).eq('period_start', periodStart);

  if (existing && existing > 0) return fail('conflict', 'Payouts already generated for this period');

  const { data: stats } = await ctx.admin
    .from('moderator_stats')
    .select('user_id, current_month_reviews, current_month_earned_nok')
    .gt('current_month_reviews', 0);

  if (!stats?.length) return ok({ redirect: '/admin/utbetalinger' });

  const payouts = stats.map((s) => ({
    moderator_id: s.user_id,
    period_start: periodStart,
    period_end: periodEnd,
    review_count: s.current_month_reviews,
    amount_nok: s.current_month_earned_nok,
    status: 'pending',
  }));

  await ctx.admin.from('moderator_payouts').insert(payouts);
  await ctx.admin.from('moderator_stats').update({
    current_month_reviews: 0, current_month_earned_nok: 0,
  }).gt('current_month_reviews', 0);

  return ok({ redirect: '/admin/utbetalinger' });
}

export async function markPaid(
  ctx: ServiceContext,
  input: { payoutId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.payoutId) return fail('bad_input', 'Invalid input');

  const denied = await requireAdmin(ctx);
  if (denied) return denied;

  await ctx.admin.from('moderator_payouts').update({
    status: 'paid', paid_at: new Date().toISOString(),
  }).eq('id', input.payoutId).eq('status', 'pending');

  return ok({ redirect: '/admin/utbetalinger' });
}
