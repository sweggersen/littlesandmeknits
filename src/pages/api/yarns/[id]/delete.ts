import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { deleteYarn } from '../../../../lib/services/yarns';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const result = await deleteYarn(ctx, { yarnId: params.id ?? '' });
  return toResponse(result, redirect);
};
