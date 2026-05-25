import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../lib/services/context';
import { simulatePromotion } from '../../../../../lib/services/promotions';
import { toResponse } from '../../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/login');
  const form = await request.formData();
  const result = await simulatePromotion(ctx, {
    listingId: params.id ?? '',
    tier: form.get('tier')?.toString() ?? '',
    requestHost: new URL(request.url).host,
  });
  return toResponse(result, redirect);
};
