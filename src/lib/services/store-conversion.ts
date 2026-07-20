// Existing-seller conversion: move all listings owned by a user into a store
// they're a member of. Opt-in, idempotent. Owner of target store only.

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { can } from './store-permissions';
import { getMyRole } from './store-members';

/**
 * Reassign the current user's personal listings (+ their seller_reviews) into a
 * store they own. Stays read-only-by-default — caller must explicitly opt in.
 *
 * Pass `listingIds` to move only a specific subset; omit to move all. Either way
 * the query is pinned to the user's own store-less listings, so a stray/foreign
 * id in the list can never move someone else's listing.
 */
export async function convertMyListingsToStore(
  ctx: ServiceContext,
  storeId: string,
  listingIds?: string[],
): Promise<ServiceResult<{ listingsMoved: number; reviewsMoved: number }>> {
  const role = await getMyRole(ctx, storeId);
  if (!can.deleteStore(role)) return fail('forbidden', 'Bare eier kan overføre eksisterende salg');

  // Move only listings that aren't already owned by some store (and, if a
  // subset was requested, only those).
  let query = ctx.admin
    .from('listings')
    .select('id')
    .eq('seller_id', ctx.user.id)
    .is('store_id', null);
  if (listingIds && listingIds.length > 0) query = query.in('id', listingIds);
  const { data: myListings } = await query;

  if (!myListings || myListings.length === 0) {
    return ok({ listingsMoved: 0, reviewsMoved: 0 });
  }

  const movedIds = myListings.map((l: any) => l.id);

  const { error: lErr } = await ctx.admin
    .from('listings')
    .update({ store_id: storeId })
    .in('id', movedIds);
  if (lErr) {
    console.error('Conversion listings update failed', lErr);
    return fail('server_error', 'Kunne ikke flytte annonser');
  }

  // Move seller_reviews for those listings (where reviewer is not the user)
  const { data: reviewRows, error: rErr } = await ctx.admin
    .from('seller_reviews')
    .update({ store_id: storeId })
    .in('listing_id', movedIds)
    .select('id');
  if (rErr) console.error('Conversion review update failed', rErr);

  return ok({ listingsMoved: movedIds.length, reviewsMoved: reviewRows?.length ?? 0 });
}
