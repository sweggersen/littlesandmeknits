import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../lib/services/context';
import { promoteListing } from '../../../../../lib/services/promotions';
import { toResponse } from '../../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const result = await promoteListing(ctx, {
    listingId: params.id!,
    tier: form.get('tier')?.toString() ?? '',
  });

  return toResponse(result, redirect);
};
