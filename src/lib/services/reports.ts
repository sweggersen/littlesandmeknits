import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

const VALID_TARGET_TYPES = new Set(['listing', 'commission_request', 'profile']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_REASONS = ['scam', 'inappropriate', 'wrong_category', 'spam', 'other'];

export async function submitReport(
  ctx: ServiceContext,
  input: { targetType: string; targetId: string; reason: string; description?: string },
): Promise<ServiceResult<void>> {
  if (!input.targetType || !VALID_TARGET_TYPES.has(input.targetType) ||
      !input.targetId || !UUID_RE.test(input.targetId) ||
      !input.reason || !VALID_REASONS.includes(input.reason)) {
    return fail('bad_input', 'Invalid input');
  }

  const { count } = await ctx.supabase
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('reporter_id', ctx.user.id)
    .eq('target_type', input.targetType)
    .eq('target_id', input.targetId);

  if (count && count > 0) return fail('conflict', 'already_reported');

  await ctx.supabase.from('reports').insert({
    reporter_id: ctx.user.id,
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason,
    description: input.description || null,
  });

  return ok(undefined as void);
}
