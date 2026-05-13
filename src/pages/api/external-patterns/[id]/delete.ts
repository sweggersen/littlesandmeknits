import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { deletePattern } from '../../../../lib/services/external-patterns';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const result = await deletePattern(ctx, { patternId: params.id ?? '' });
  return toResponse(result, redirect);
};
