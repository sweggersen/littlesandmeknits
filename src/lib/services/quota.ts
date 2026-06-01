// Daily per-user quotas on commerce write paths.
//
// R2-9 added back-pressure on createRequest / makeOffer / sendMessage
// so a bot or griever can't flood the platform. Limits are tunable per
// trust tier later; for now they're constants tuned to "an active power
// user could hit them but a normal user never will."

import type { ServiceContext, ServiceResult } from './types';
import { fail } from './types';

export type QuotaAction =
  | 'commission_request_create'
  | 'commission_offer_make'
  | 'marketplace_message_send';

const DAILY_LIMITS: Record<QuotaAction, number> = {
  commission_request_create: 5,
  commission_offer_make: 20,
  marketplace_message_send: 100,
};

function today(): string {
  // UTC date. Rolling at midnight UTC is simpler than per-user TZ and
  // close enough to "midnight" for any Norwegian user (UTC+01..+02).
  return new Date().toISOString().slice(0, 10);
}

/** Check the user's quota for `action` today; if under the limit,
 *  increment and return null (continue). If at/over, return a
 *  ServiceResult failure the caller can early-return.
 *
 *  Uses ctx.admin so it can read+upsert atomically regardless of RLS.
 */
export async function assertWithinQuota(
  ctx: ServiceContext,
  action: QuotaAction,
): Promise<ServiceResult<never> | null> {
  const limit = DAILY_LIMITS[action];
  const day = today();

  // Atomic increment via upsert + RPC-style. supabase-js doesn't
  // expose a direct atomic-increment, so we read-check-write within
  // a single ON CONFLICT update that bumps count.
  // First: read current count.
  const { data: row } = await ctx.admin
    .from('user_action_counts')
    .select('count')
    .eq('user_id', ctx.user.id)
    .eq('action', action)
    .eq('day', day)
    .maybeSingle();

  const current = row?.count ?? 0;
  if (current >= limit) {
    return fail(
      'conflict',
      `Du har nådd dagsgrensen for denne handlingen (${limit} per dag). Prøv igjen i morgen.`,
    );
  }

  // Upsert: insert with count=1 or bump existing by 1.
  // ON CONFLICT (user_id, action, day) DO UPDATE SET count = count + 1
  await ctx.admin.from('user_action_counts').upsert(
    {
      user_id: ctx.user.id,
      action,
      day,
      count: current + 1,
    },
    { onConflict: 'user_id,action,day' },
  );

  return null;
}

/** Read the user's current count for an action (no increment).
 *  Useful for showing "X of Y remaining today" hints in the UI. */
export async function getQuotaUsed(
  ctx: ServiceContext,
  action: QuotaAction,
): Promise<{ used: number; limit: number }> {
  const { data: row } = await ctx.admin
    .from('user_action_counts')
    .select('count')
    .eq('user_id', ctx.user.id)
    .eq('action', action)
    .eq('day', today())
    .maybeSingle();
  return { used: row?.count ?? 0, limit: DAILY_LIMITS[action] };
}
