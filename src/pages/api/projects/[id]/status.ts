import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { updateStatus } from '../../../../lib/services/projects';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await updateStatus(ctx, {
    projectId: params.id ?? '',
    status: form.get('status')?.toString() ?? '',
  });
  return toResponse(result, redirect);
};
