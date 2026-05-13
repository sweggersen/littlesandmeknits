import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { updateProgress } from '../../../../lib/services/projects';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await updateProgress(ctx, {
    projectId: params.id ?? '',
    targetRows: form.get('target_rows')?.toString(),
    currentRows: form.get('current_rows')?.toString(),
  });
  return toResponse(result, redirect);
};
