// POST /api/stores/:slug/restore — restore a soft-deleted store within
// its 90-day window. Owner-only.
import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { getStoreBySlugAdmin, restoreStore } from '../../../../lib/services/stores';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const store = await getStoreBySlugAdmin(ctx, params.slug ?? '');
  if (!store) return new Response('Not found', { status: 404 });
  const result = await restoreStore(ctx, store.id);
  if (!result.ok) return toResponse(result);
  const wantsRedirect = !(request.headers.get('content-type') ?? '').includes('application/json');
  if (wantsRedirect) return redirect(`/market/store/${store.slug}/admin`);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
