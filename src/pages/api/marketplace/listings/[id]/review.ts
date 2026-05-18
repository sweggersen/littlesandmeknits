import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../lib/services/context';
import { submitSellerReview } from '../../../../../lib/services/seller-reviews';
import { toResponse } from '../../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await submitSellerReview(ctx, {
    listingId: params.id ?? '',
    rating: parseInt(form.get('rating')?.toString() ?? '0', 10),
    comment: form.get('comment')?.toString(),
  });

  if (!result.ok) return toResponse(result);
  return redirect(result.data.redirect, 303);
};
