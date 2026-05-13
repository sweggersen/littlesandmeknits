import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { uploadProjectPhoto } from '../../../../lib/services/projects';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const file = form.get('hero_photo');
  const result = await uploadProjectPhoto(ctx, {
    projectId: params.id ?? '',
    heroPhoto: file instanceof File ? file : null,
  });
  return toResponse(result, redirect);
};
