import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../lib/services/context';
import { bookListingShipping } from '../../../../../lib/services/listing-shipping';
import { toResponse } from '../../../../../lib/services/response';

// Generate a real Posten/Bring shipping label for a listing sale (auto-filled
// with the buyer's address), then capture-at-ship. Falls back to the manual
// tracking form when the carrier isn't configured (service returns 503).
export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/login');

  const form = await request.formData();
  const weightRaw = form.get('weight_grams')?.toString();
  const weightGrams = weightRaw ? parseInt(weightRaw, 10) : undefined;

  const result = await bookListingShipping(ctx, {
    listingId: params.id ?? '',
    weightGrams: Number.isFinite(weightGrams) ? weightGrams : undefined,
  });
  return toResponse(result, redirect);
};
