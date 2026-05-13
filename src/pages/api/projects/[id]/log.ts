import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { addProgressLog } from '../../../../lib/services/projects';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const photos = form.getAll('photos').filter((p): p is File => p instanceof File && p.size > 0);
  const result = await addProgressLog(ctx, {
    projectId: params.id ?? '',
    body: form.get('body')?.toString() ?? '',
    logDate: form.get('log_date')?.toString(),
    rowsAt: form.get('rows_at')?.toString(),
    photos,
  });
  return toResponse(result, redirect);
};
