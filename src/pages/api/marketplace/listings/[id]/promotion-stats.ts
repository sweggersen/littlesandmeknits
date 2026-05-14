import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../lib/services/context';
import { getPromotionStats } from '../../../../../lib/services/promotions';
import { toResponse } from '../../../../../lib/services/response';

export const GET: APIRoute = async ({ params, request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const result = await getPromotionStats(ctx, { listingId: params.id! });
  return toResponse(result);
};
