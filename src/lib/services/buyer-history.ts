import type { ServiceContext } from './types';

// P1.3 — buyer dispute/refund history.
//
// Repeat "not as described / never arrived" claimers are the classic
// marketplace-abuse pattern: buy, receive, claim a refund, keep the item. A
// moderator resolving a single dispute can't see the pattern from one case.
// This surfaces the buyer's whole claim history so staff can weigh it.
//
// Source of truth is the DURABLE tables, deliberately NOT `listings`:
//   - `orders.buyer_id` is NOT NULL and never cleared. (A listing refund resets
//     `listings.buyer_id` to null for resale — so listings lose the buyer link
//     exactly when a claim succeeds. Orders keep it.)
//   - `commission_requests.buyer_id` is durable too.
// One "claim" is counted per purchase (an order/commission that had a refund
// request OR a dispute), so a refund-request that escalates into a formal
// dispute on the same order is not double-counted.

export interface BuyerHistoryOrder {
  refund_requested_at: string | null;
  disputed_at: string | null;
  refund_outcome: string | null;   // 'accepted' | 'declined' | null
  cancel_reason: string | null;    // 'refund_accepted' | 'admin_refund' | ...
}

export interface BuyerHistoryCommission {
  status: string;
  disputed_at: string | null;
}

export interface BuyerDisputeHistory {
  /** Listing orders + paid commissions attributed to this buyer. */
  purchases: number;
  /** Purchases where the buyer opened a refund request and/or a dispute. */
  claims: number;
  /** Subset of claims that ended with money returned to the buyer. */
  upheldClaims: number;
  /** claims / max(1, purchases), rounded to 2 decimals. */
  claimRate: number;
  /**
   * Heuristic abuse flag — NOT an automatic decision. True when the buyer has
   * made >= 3 claims AND claimed on at least half their purchases. Shown to
   * staff as a prompt to look closer, never as a verdict.
   */
  repeatClaimer: boolean;
}

export const REPEAT_CLAIMER_MIN_CLAIMS = 3;
export const REPEAT_CLAIMER_MIN_RATE = 0.5;

/** Pure aggregation — unit-tested without a DB. */
export function computeBuyerDisputeHistory(input: {
  orders: BuyerHistoryOrder[];
  commissions: BuyerHistoryCommission[];
}): BuyerDisputeHistory {
  const { orders, commissions } = input;
  const purchases = orders.length + commissions.length;

  const orderClaims = orders.filter(
    (o) => o.refund_requested_at != null || o.disputed_at != null,
  );
  const commissionClaims = commissions.filter((c) => c.disputed_at != null);
  const claims = orderClaims.length + commissionClaims.length;

  // Money-returned outcomes on the listing side. Commission refund outcomes
  // aren't modelled as a flag on the request, so commission claims count toward
  // `claims` but not `upheldClaims` (conservative — never overstates upheld).
  const upheldClaims = orders.filter(
    (o) =>
      o.refund_outcome === 'accepted' ||
      o.cancel_reason === 'refund_accepted' ||
      o.cancel_reason === 'admin_refund',
  ).length;

  const claimRate = purchases === 0 ? 0 : Math.round((claims / purchases) * 100) / 100;
  const repeatClaimer =
    claims >= REPEAT_CLAIMER_MIN_CLAIMS && claimRate >= REPEAT_CLAIMER_MIN_RATE;

  return { purchases, claims, upheldClaims, claimRate, repeatClaimer };
}

/**
 * Fetch + aggregate a buyer's claim history. Reads through the caller's client
 * (admin pages pass their staff-read RLS client). Returns zeroed history if the
 * buyer id is missing so callers can render unconditionally.
 */
export async function buyerDisputeHistory(
  db: ServiceContext['supabase'],
  buyerId: string | null | undefined,
): Promise<BuyerDisputeHistory> {
  if (!buyerId) return computeBuyerDisputeHistory({ orders: [], commissions: [] });

  const [ordersRes, commissionsRes] = await Promise.all([
    db
      .from('orders')
      .select('refund_requested_at, disputed_at, refund_outcome, cancel_reason')
      .eq('buyer_id', buyerId),
    db
      .from('commission_requests')
      .select('status, disputed_at')
      .eq('buyer_id', buyerId),
  ]);

  return computeBuyerDisputeHistory({
    orders: (ordersRes.data ?? []) as BuyerHistoryOrder[],
    commissions: (commissionsRes.data ?? []) as BuyerHistoryCommission[],
  });
}
