// Store asset endpoints.
//   POST   /api/stores/:slug/assets   (multipart: kind, file, alt?) -> upload
//   DELETE /api/stores/:slug/assets?assetId=…                       -> delete
// Both member-gated + validated in the store-page service.
import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { getStoreBySlugAdmin } from '../../../../lib/services/stores';
import { uploadStoreAsset, deleteStoreAsset } from '../../../../lib/services/store-page';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const store = await getStoreBySlugAdmin(ctx, params.slug ?? '');
  if (!store) return new Response('Not found', { status: 404 });

  const form = await request.formData();
  const kind = form.get('kind')?.toString() ?? '';
  const alt = form.get('alt')?.toString() ?? null;
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return new Response('Missing file', { status: 400 });

  return toResponse(await uploadStoreAsset(ctx, store.id, kind, file, alt));
};

export const DELETE: APIRoute = async ({ params, request, cookies, url }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const store = await getStoreBySlugAdmin(ctx, params.slug ?? '');
  if (!store) return new Response('Not found', { status: 404 });

  const assetId = url.searchParams.get('assetId') ?? '';
  if (!assetId) return new Response('Missing assetId', { status: 400 });
  return toResponse(await deleteStoreAsset(ctx, store.id, assetId));
};
