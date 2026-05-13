import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { changeUserRole } from '../../../../lib/services/moderation';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const result = await changeUserRole(ctx, {
    userId: form.get('user_id')?.toString() ?? '',
    role: form.get('role')?.toString() ?? '',
  });
  return toResponse(result, redirect);
};
