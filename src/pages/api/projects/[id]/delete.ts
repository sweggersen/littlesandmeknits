import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { deleteProject } from '../../../../lib/services/projects';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const result = await deleteProject(ctx, { projectId: params.id ?? '' });
  return toResponse(result, redirect);
};
