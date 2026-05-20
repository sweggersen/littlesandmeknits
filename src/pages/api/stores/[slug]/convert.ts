// POST /api/stores/:slug/convert
// Move all of the current user's personal listings into the store.
// Owner-only, idempotent.
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

  const result = await convertMyListingsToStore(ctx, store.id);
  if (!result.ok) return toResponse(result);

  const wantsRedirect = !(request.headers.get('content-type') ?? '').includes('application/json');
  if (wantsRedirect) return redirect(`/market/store/${store.slug}/admin/listings`);
  return new Response(JSON.stringify({ ok: true, ...result.data }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
