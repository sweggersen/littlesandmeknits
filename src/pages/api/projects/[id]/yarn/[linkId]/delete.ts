import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../../lib/services/context';
import { unlinkYarn } from '../../../../../../lib/services/projects';
import { toResponse } from '../../../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const result = await unlinkYarn(ctx, { projectId: params.id ?? '', linkId: params.linkId ?? '' });
  return toResponse(result, redirect);
};
