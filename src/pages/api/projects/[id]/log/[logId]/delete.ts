import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../../lib/services/context';
import { deleteProgressLog } from '../../../../../../lib/services/projects';
import { toResponse } from '../../../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const result = await deleteProgressLog(ctx, { projectId: params.id ?? '', logId: params.logId ?? '' });
  return toResponse(result, redirect);
};
