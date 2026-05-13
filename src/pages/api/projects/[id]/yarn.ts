import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { linkYarn } from '../../../../lib/services/projects';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await linkYarn(ctx, {
    projectId: params.id ?? '',
    yarnId: form.get('yarn_id')?.toString() ?? '',
    gramsUsed: form.get('grams_used')?.toString() ?? '',
  });
  return toResponse(result, redirect);
};
