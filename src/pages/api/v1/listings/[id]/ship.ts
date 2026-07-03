import type { APIRoute } from 'astro';
import { requireCtx, jsonResult } from '../../../../../lib/api/v1';
import { shipListing } from '../../../../../lib/services/listings';

// POST /api/v1/listings/:id/ship — seller marks a reserved listing shipped
// (captures the escrow PaymentIntent). Body: { trackingCode }.
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const ctx = await requireCtx(request, cookies);
  if (ctx instanceof Response) return ctx;

  const body = await request.json().catch(() => ({}));
  const result = await shipListing(ctx, {
    listingId: params.id ?? '',
    trackingCode: typeof body.trackingCode === 'string' ? body.trackingCode : '',
  });
  return jsonResult(result);
};
