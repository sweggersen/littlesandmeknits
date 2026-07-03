import type { APIRoute } from 'astro';
import { requireCtx, jsonResult } from '../../../../../lib/api/v1';
import { confirmListingDelivery } from '../../../../../lib/services/listings';

// POST /api/v1/listings/:id/confirm-delivery — buyer confirms receipt, which
// releases the escrow hold to the seller.
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const ctx = await requireCtx(request, cookies);
  if (ctx instanceof Response) return ctx;

  const result = await confirmListingDelivery(ctx, { listingId: params.id ?? '' });
  return jsonResult(result);
};
