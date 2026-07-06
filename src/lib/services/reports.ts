import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createNotification } from '../notify';
import { assertWithinQuota } from './quota';

const VALID_TARGET_TYPES = new Set(['listing', 'commission_request', 'profile', 'store']);
const TARGET_LABEL: Record<string, string> = {
  listing: 'annonse', commission_request: 'oppdrag', store: 'butikk', profile: 'profil',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_REASONS = ['scam', 'inappropriate', 'wrong_category', 'spam', 'other'];

export async function submitReport(
  ctx: ServiceContext,
  input: { targetType: string; targetId: string; reason: string; description?: string; anonymous?: boolean },
): Promise<ServiceResult<void>> {
  if (!input.targetType || !VALID_TARGET_TYPES.has(input.targetType) ||
      !input.targetId || !UUID_RE.test(input.targetId) ||
      !input.reason || !VALID_REASONS.includes(input.reason)) {
    return fail('bad_input', 'Invalid input');
  }

  // Daily quota — a griefer can't mass-flag many different targets (the
  // per-target dedup below only stops repeat-reporting the SAME target).
  const quotaFail = await assertWithinQuota(ctx, 'report_create');
  if (quotaFail) return quotaFail;

  const { count } = await ctx.supabase
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('reporter_id', ctx.user.id)
    .eq('target_type', input.targetType)
    .eq('target_id', input.targetId);

  if (count && count > 0) return fail('conflict', 'already_reported');

  const { error } = await ctx.supabase.from('reports').insert({
    reporter_id: ctx.user.id,
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason as 'scam' | 'inappropriate' | 'wrong_category' | 'spam' | 'other',
    description: input.description || null,
    anonymous: !!input.anonymous,
  });
  if (error) {
    console.error('Report insert failed', error);
    return fail('server_error', 'Kunne ikke sende rapport — prøv igjen.');
  }

  // Notify moderators. Skip if there's already an open report on this
  // target — we only want to ping once, not every duplicate report.
  try {
    const { count: openCount } = await ctx.admin
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .eq('target_type', input.targetType)
      .eq('target_id', input.targetId)
      .eq('status', 'open');

    if ((openCount ?? 0) <= 1) {
      let itemTitle: string | null = null;
      if (input.targetType === 'listing') {
        const { data } = await ctx.admin.from('listings').select('title').eq('id', input.targetId).maybeSingle();
        itemTitle = data?.title ?? null;
      } else if (input.targetType === 'commission_request') {
        const { data } = await ctx.admin.from('commission_requests').select('title').eq('id', input.targetId).maybeSingle();
        itemTitle = data?.title ?? null;
      } else if (input.targetType === 'store') {
        const { data } = await ctx.admin.from('stores').select('name').eq('id', input.targetId).maybeSingle();
        itemTitle = data?.name ?? null;
      }

      const { data: mods } = await ctx.admin
        .from('profiles').select('id').in('role', ['admin', 'moderator']);
      for (const m of mods ?? []) {
        if (m.id === ctx.user.id) continue;
        await createNotification(ctx.admin, {
          userId: m.id,
          type: 'item_reported',
          title: `Ny rapport: ${TARGET_LABEL[input.targetType] ?? 'element'}`,
          body: itemTitle ? `«${itemTitle}» ble rapportert.` : 'Et nytt element ble rapportert.',
          url: '/admin/reports',
          actorId: ctx.user.id,
          referenceId: input.targetId,
        }, ctx.env);
      }
    }
  } catch (err) {
    console.error('Report notification fan-out failed', err);
  }

  return ok(undefined as void);
}
