import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../lib/services/context';
import { markListingSold } from '../../../../../lib/services/listings';
import { toResponse } from '../../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/login');

  const result = await markListingSold(ctx, { listingId: params.id ?? '' });
  return toResponse(result, redirect);
};
