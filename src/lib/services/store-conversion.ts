// Existing-seller conversion: move all listings owned by a user into a store
// they're a member of. Opt-in, idempotent. Owner of target store only.

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { can } from './store-permissions';
import { getMyRole } from './store-members';

/**
 * Reassign all listings + their seller_reviews from the current user to the
 * given store. Stays read-only-by-default — caller must explicitly opt in.
 */
export async function convertMyListingsToStore(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<{ listingsMoved: number; reviewsMoved: number }>> {
  const role = await getMyRole(ctx, storeId);
  if (!can.deleteStore(role)) return fail('forbidden', 'Bare eier kan overføre eksisterende salg');

  // Move only listings that aren't already owned by some store
  const { data: myListings } = await ctx.admin
    .from('listings')
    .select('id')
    .eq('seller_id', ctx.user.id)
    .is('store_id', null);

  if (!myListings || myListings.length === 0) {
    return ok({ listingsMoved: 0, reviewsMoved: 0 });
  }

  const listingIds = myListings.map((l: any) => l.id);

  const { error: lErr } = await ctx.admin
    .from('listings')
    .update({ store_id: storeId })
    .in('id', listingIds);
  if (lErr) {
    console.error('Conversion listings update failed', lErr);
    return fail('server_error', 'Kunne ikke flytte annonser');
  }

  // Move seller_reviews for those listings (where reviewer is not the user)
  const { data: reviewRows, error: rErr } = await ctx.admin
    .from('seller_reviews')
    .update({ store_id: storeId })
    .in('listing_id', listingIds)
    .select('id');
  if (rErr) console.error('Conversion review update failed', rErr);

  return ok({ listingsMoved: listingIds.length, reviewsMoved: reviewRows?.length ?? 0 });
}
