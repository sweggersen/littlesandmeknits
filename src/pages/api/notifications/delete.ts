import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { deleteNotification } from '../../../lib/services/notifications';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await deleteNotification(ctx, { notificationId: form.get('id')?.toString() ?? '' });
  return toResponse(result, redirect);
};
