// Helper for admin pages: load the store + verify the user is a member.
// Returns a redirect Response if unauthorised so pages can early-return.

import type { AstroCookies } from 'astro';
import { buildServiceContext } from './context';
import { getStoreBySlugAdmin } from './stores';
import { getMyRole } from './store-members';
import type { Store, StoreRole } from '../types/stores';

export interface AdminGuardResult {
  ctx: NonNullable<Awaited<ReturnType<typeof buildServiceContext>>>;
  store: Store;
  role: StoreRole;
}

export async function guardStoreAdmin(
  request: Request,
  cookies: AstroCookies,
  slug: string,
): Promise<AdminGuardResult | Response> {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/login?next=/market/store/${slug}/admin` },
    });
  }
  const store = await getStoreBySlugAdmin(ctx, slug);
  if (!store) return new Response('Not found', { status: 404 });
  const role = await getMyRole(ctx, store.id);
  if (!role) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/market/store/${slug}` },
    });
  }
  return { ctx, store, role };
}
