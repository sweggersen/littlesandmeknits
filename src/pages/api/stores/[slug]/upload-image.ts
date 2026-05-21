// POST /api/stores/:slug/upload-image  (multipart form: kind=logo|banner, file)
import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { getStoreBySlugAdmin, uploadStoreImage } from '../../../../lib/services/stores';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const store = await getStoreBySlugAdmin(ctx, params.slug ?? '');
  if (!store) return new Response('Not found', { status: 404 });

  const form = await request.formData();
  const kind = form.get('kind')?.toString();
  const file = form.get('file');
  if (kind !== 'logo' && kind !== 'banner') return new Response('Invalid kind', { status: 400 });
  if (!(file instanceof File) || file.size === 0) return new Response('Missing file', { status: 400 });

  const result = await uploadStoreImage(ctx, store.id, kind, file);
  if (!result.ok) return toResponse(result);
  return redirect(`/market/store/${store.slug}/admin/settings?uploaded=${kind}`);
};
