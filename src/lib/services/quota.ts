// Daily per-user quotas on commerce write paths.
//
// R2-9 added back-pressure on createRequest / makeOffer / sendMessage
// so a bot or griever can't flood the platform. Limits are tunable per
// trust tier later; for now they're constants tuned to "an active power
// user could hit them but a normal user never will."

import type { ServiceContext, ServiceResult } from './types';
import { fail } from './types';
import { log } from '../log';

export type QuotaAction =
  | 'commission_request_create'
  | 'commission_offer_make'
  | 'marketplace_message_send'
  | 'support_request_create'
  | 'report_create'
  | 'pattern_checkout'
  | 'purchase_checkout'
  | 'listing_create'
  | 'store_create'
  | 'store_invite';

const DAILY_LIMITS: Record<QuotaAction, number> = {
  commission_request_create: 5,
  commission_offer_make: 20,
  marketplace_message_send: 100,
  support_request_create: 10,
  // A genuine user reports a handful of times a day at most; a griefer
  // mass-flagging different targets is what this caps.
  report_create: 20,
  // Each pattern checkout creates a Stripe Checkout Session (API cost). A buyer
  // comparing patterns clicks a few times; this caps session-creation spam.
  pattern_checkout: 30,
  // Buying a listing / paying a commission each mints a Stripe Checkout Session
  // (API cost). A real buyer completes a few a day; this caps session-creation
  // spam without biting genuine retries.
  purchase_checkout: 30,
  // A busy seller lists a lot in one session; this only bites a bot flooding
  // drafts. (Publishing is separate and requires a photo.)
  listing_create: 50,
  // Creating a store hits Brønnøysund + writes a moderation-queue item; a real
  // user makes one or two, so a low cap stops spam-store flooding.
  store_create: 5,
  // Invite-flooding back-pressure (each can send an email).
  store_invite: 30,
};

function today(): string {
  // UTC date. Rolling at midnight UTC is simpler than per-user TZ and
  // close enough to "midnight" for any Norwegian user (UTC+01..+02).
  return new Date().toISOString().slice(0, 10);
}

/** Check the user's quota for `action` today; if under the limit,
 *  atomically increment and return null (continue). If at/over, return a
 *  ServiceResult failure the caller can early-return.
 *
 *  The increment happens in a single Postgres statement (bump_action_count
 *  RPC, migration 0119): concurrent callers serialize on the row and can't both
 *  slip past the cap. A read-then-write here would be bypassable by firing
 *  requests in parallel (this is the only throttle on Stripe-session minting +
 *  message/report floods). RPC returns the new count, or -1 when at/over limit.
 */
export async function assertWithinQuota(
  ctx: ServiceContext,
  action: QuotaAction,
): Promise<ServiceResult<never> | null> {
  const limit = DAILY_LIMITS[action];

  const { data, error } = await ctx.admin.rpc('bump_action_count', {
    p_user_id: ctx.user.id,
    p_action: action,
    p_day: today(),
    p_limit: limit,
  });

  if (error) {
    // Fail-open on a counter failure (availability > strictness for a transient
    // DB error), but surface it — a genuine parallel-abuse attempt still
    // serializes correctly on the row and does NOT hit this path.
    log.error('quota.bump_failed', { action, message: error.message });
    return null;
  }

  if (typeof data === 'number' && data < 0) {
    return fail(
      'conflict',
      `Du har nådd dagsgrensen for denne handlingen (${limit} per dag). Prøv igjen i morgen.`,
    );
  }

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
