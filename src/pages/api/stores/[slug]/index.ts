// PATCH /api/stores/:slug — update store settings
// DELETE /api/stores/:slug — soft delete (owner only)
import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { getStoreBySlugAdmin, updateStore, softDeleteStore } from '../../../../lib/services/stores';
import { toResponse } from '../../../../lib/services/response';

async function loadStoreOrFail(ctx: any, slug: string) {
  const store = await getStoreBySlugAdmin(ctx, slug);
  if (!store) return null;
  return store;
}

export const PATCH: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const slug = params.slug ?? '';
  const store = await loadStoreOrFail(ctx, slug);
  if (!store) return new Response('Not found', { status: 404 });

  const contentType = request.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await request.json()
    : Object.fromEntries((await request.formData()).entries());

  const result = await updateStore(ctx, store.id, body as any);
  return toResponse(result, contentType.includes('application/json') ? undefined : redirect);
};

export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const store = await loadStoreOrFail(ctx, params.slug ?? '');
  if (!store) return new Response('Not found', { status: 404 });
  const result = await softDeleteStore(ctx, store.id);
  return toResponse(result);
};

// POST is used as a fallback for HTML forms that can't send PATCH/DELETE.
// _method=delete -> softDeleteStore; otherwise treat as PATCH.
export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const store = await loadStoreOrFail(ctx, params.slug ?? '');
  if (!store) return new Response('Not found', { status: 404 });

  const form = await request.formData();
  const method = form.get('_method')?.toString().toLowerCase();
  if (method === 'delete') {
    const result = await softDeleteStore(ctx, store.id);
    if (result.ok) return redirect('/profile/stores');
    return toResponse(result);
  }
  const body = Object.fromEntries([...form.entries()].map(([k, v]) => [k, v.toString()]));
  const result = await updateStore(ctx, store.id, body as any);
  if (result.ok) return redirect(`/market/store/${store.slug}/admin/settings`);
  return toResponse(result);
};
