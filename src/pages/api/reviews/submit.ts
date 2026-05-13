import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { submitReview } from '../../../lib/services/reviews';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const result = await submitReview(ctx, {
    commissionRequestId: form.get('commission_request_id')?.toString() ?? '',
    rating: parseInt(form.get('rating')?.toString() ?? '', 10),
    comment: form.get('comment')?.toString(),
  });
  return toResponse(result);
};
