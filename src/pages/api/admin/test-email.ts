import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { sendTestEmail } from '../../../lib/services/admin-mail';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const result = await sendTestEmail(ctx, {
    templateKey: String(form.get('template') ?? ''),
  });
  return toResponse(result, redirect);
};
