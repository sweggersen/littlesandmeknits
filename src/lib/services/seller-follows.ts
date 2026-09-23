// Follow-a-seller service. A follow subscribes the user to a seller's new-listing
// notifications + the "selgere du følger" feed. Mirrors toggleStoreFollow; goes
// through the service layer (the route used to inline these writes). RLS
// (follower_id = auth.uid()) is the second gate.

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

/** Toggle the current user's follow on a seller. Insert; on the unique-PK
 *  violation (23505) it already existed, so delete instead. */
export async function toggleSellerFollow(
  ctx: ServiceContext,
  sellerId: string,
): Promise<ServiceResult<{ following: boolean }>> {
  if (!sellerId) return fail('bad_input', 'Mangler selger-ID');
  if (sellerId === ctx.user.id) return fail('bad_input', 'Du kan ikke følge deg selv');

  const { error } = await ctx.supabase
    .from('seller_follows')
    .insert({ follower_id: ctx.user.id, seller_id: sellerId } as never);

  if (error?.code === '23505') {
    const { error: delErr } = await ctx.supabase
      .from('seller_follows')
      .delete()
      .eq('follower_id', ctx.user.id)
      .eq('seller_id', sellerId);
    if (delErr) return fail('server_error', 'Kunne ikke oppdatere følging');
    return ok({ following: false });
  }

  if (error) {
    // 23503 = FK violation → the seller id doesn't exist (or isn't visible).
    if (error.code === '23503') return fail('not_found', 'Selger ikke funnet');
    console.error('Seller follow toggle failed', error);
    return fail('server_error', 'Kunne ikke følge selgeren');
  }

  return ok({ following: true });
}
