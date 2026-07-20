// POST /api/stores/:slug/convert
// Move the current user's personal listings into the store. Owner-only,
// idempotent. Pass `listing_ids` (form) or `listingIds` (JSON) to move a
// specific subset; omit to move all.
import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { getStoreBySlugAdmin } from '../../../../lib/services/stores';
import { convertMyListingsToStore } from '../../../../lib/services/store-conversion';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const store = await getStoreBySlugAdmin(ctx, params.slug ?? '');
  if (!store) return new Response('Not found', { status: 404 });

  const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
  let listingIds: string[] | undefined;
  if (isJson) {
    const body = await request.json().catch(() => null);
    if (Array.isArray(body?.listingIds)) listingIds = body.listingIds.map(String);
  } else {
    const form = await request.formData();
    const ids = form.getAll('listing_ids').map(String).filter(Boolean);
    if (ids.length) listingIds = ids;
  }

  const result = await convertMyListingsToStore(ctx, store.id, listingIds);
  if (!result.ok) return toResponse(result);

  if (!isJson) return redirect(`/market/store/${store.slug}/admin/listings`);
  return new Response(JSON.stringify({ ok: true, ...result.data }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
