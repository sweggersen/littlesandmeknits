import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { getTracking } from '../../../../lib/services/commissions';
import { toResponse } from '../../../../lib/services/response';

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const result = await getTracking(ctx, { requestId: url.searchParams.get('request_id') ?? '' });
  return toResponse(result);
};
