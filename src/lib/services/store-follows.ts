// Follow-a-store service (Butikker Phase 2). A follow subscribes the user to a
// store's activity (the "butikker du følger" feed + store_new_listing
// notifications). Distinct from store_favorites (a bookmark). Goes through the
// service layer (unlike the legacy inline seller-follow route); RLS
// (follower_id = auth.uid()) is the second gate.

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

/** Toggle the current user's follow on a store. Insert; on the unique-PK
 *  violation (23505) it already existed, so delete instead. */
export async function toggleStoreFollow(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<{ following: boolean }>> {
  if (!storeId) return fail('bad_input', 'Mangler butikk-ID');

  const { error } = await ctx.supabase
    .from('store_follows')
    .insert({ follower_id: ctx.user.id, store_id: storeId } as never);

  if (error?.code === '23505') {
    await ctx.supabase
      .from('store_follows')
      .delete()
      .eq('follower_id', ctx.user.id)
      .eq('store_id', storeId);
    return ok({ following: false });
  }

  if (error) {
    // 23503 = FK violation → the store id doesn't exist (or isn't visible).
    if (error.code === '23503') return fail('not_found', 'Butikk ikke funnet');
    console.error('Store follow toggle failed', error);
    return fail('server_error', 'Kunne ikke følge butikken');
  }

  return ok({ following: true });
}
