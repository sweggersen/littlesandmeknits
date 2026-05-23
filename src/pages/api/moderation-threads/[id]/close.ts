import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { closeThread } from '../../../../lib/services/moderation-threads';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const result = await closeThread(ctx, {
    threadId: params.id ?? '',
    unfreeze: form.get('unfreeze')?.toString() === 'true',
    notes: form.get('notes')?.toString(),
  });
  return toResponse(result, redirect);
};
