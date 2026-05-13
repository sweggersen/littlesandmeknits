import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { shareProject } from '../../../../lib/services/projects';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await shareProject(ctx, {
    projectId: params.id ?? '',
    share: form.get('share')?.toString() === 'true',
  });
  return toResponse(result, redirect);
};
