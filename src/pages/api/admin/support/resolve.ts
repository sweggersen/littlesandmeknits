import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { resolveSupportRequest } from '../../../../lib/services/support';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const result = await resolveSupportRequest(ctx, {
    id: form.get('id')?.toString(),
    note: form.get('note')?.toString(),
  });
  return toResponse(result, redirect);
};
