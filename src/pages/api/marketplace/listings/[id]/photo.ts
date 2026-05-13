import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../lib/services/context';
import { deleteListingPhoto, captionListingPhoto, reorderListingPhotos, uploadListingPhotos } from '../../../../../lib/services/listings';
import { toResponse } from '../../../../../lib/services/response';

function wantsJson(request: Request) {
  return request.headers.get('Accept')?.includes('application/json');
}

function okResponse(request: Request, redirectUrl: string, body: Record<string, unknown> = {}) {
  if (wantsJson(request)) return Response.json({ ok: true, ...body });
  return Response.redirect(new URL(redirectUrl, request.url), 303);
}

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const id = params.id ?? '';
  const { data: listing } = await ctx.supabase
    .from('listings').select('id, seller_id').eq('id', id).maybeSingle();
  if (!listing || listing.seller_id !== ctx.user.id) return new Response('Not found', { status: 404 });

  const form = await request.formData();
  const action = form.get('action')?.toString();

  if (action === 'delete') {
    const photoId = form.get('photo_id')?.toString();
    if (!photoId) return new Response('Missing photo_id', { status: 400 });
    const result = await deleteListingPhoto(ctx, { listingId: id, photoId });
    if (!result.ok) return toResponse(result);
    return okResponse(request, `/marked/listing/${id}`);
  }

  if (action === 'caption') {
    const photoId = form.get('photo_id')?.toString();
    if (!photoId) return new Response('Missing photo_id', { status: 400 });
    const result = await captionListingPhoto(ctx, { listingId: id, photoId, caption: form.get('caption')?.toString() ?? '' });
    if (!result.ok) return toResponse(result);
    return okResponse(request, `/marked/listing/${id}`);
  }

  if (action === 'reorder') {
    const orderJson = form.get('order')?.toString();
    if (!orderJson) return new Response('Missing order', { status: 400 });
    try {
      const ids: string[] = JSON.parse(orderJson);
      const result = await reorderListingPhotos(ctx, { listingId: id, order: ids });
      if (!result.ok) return toResponse(result);
      return okResponse(request, `/marked/listing/${id}`);
    } catch {
      return new Response('Invalid order', { status: 400 });
    }
  }

  const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
  const result = await uploadListingPhotos(ctx, { listingId: id, files });
  return toResponse(result, redirect);
};
