// Favourite-a-store service. Mirrors favorites.ts (listings/commissions) but
// against the dedicated store_favorites table, which also carries last_seen_at
// for the "new listings since your last visit" dot.

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

/** Toggle the current user's favourite for a store. Insert; on the unique-PK
 *  violation (23505) it already existed, so delete instead. Uses the cookie-
 *  bound client so RLS (user_id = auth.uid()) is the second gate. */
export async function toggleStoreFavorite(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<{ favorited: boolean }>> {
  if (!storeId) return fail('bad_input', 'Mangler butikk-ID');

  const { error } = await ctx.supabase
    .from('store_favorites')
    .insert({ user_id: ctx.user.id, store_id: storeId } as never);

  if (error?.code === '23505') {
    await ctx.supabase
      .from('store_favorites')
      .delete()
      .eq('user_id', ctx.user.id)
      .eq('store_id', storeId);
    return ok({ favorited: false });
  }

  if (error) {
    // 23503 = FK violation → the store id doesn't exist (or isn't visible).
    if (error.code === '23503') return fail('not_found', 'Butikk ikke funnet');
    console.error('Store favorite toggle failed', error);
    return fail('server_error', 'Kunne ikke lagre favoritt');
  }

  return ok({ favorited: true });
}

/** Bump last_seen_at to now for a favourited store. Called from the store
 *  detail page load. No-op (0 rows) when the store isn't favourited — the
 *  eq(user_id) guard + RLS keep it scoped to the caller's own row. */
export async function markStoreSeen(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<{ ok: true }>> {
  if (!storeId) return fail('bad_input', 'Mangler butikk-ID');

  const { error } = await ctx.supabase
    .from('store_favorites')
    .update({ last_seen_at: new Date().toISOString() } as never)
    .eq('user_id', ctx.user.id)
    .eq('store_id', storeId);

  if (error) {
    console.error('markStoreSeen failed', error);
    return fail('server_error', 'Kunne ikke oppdatere');
  }
  return ok({ ok: true });
}
