import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { reply } from '../../../../lib/services/conversations';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await reply(ctx, {
    conversationId: form.get('conversation_id')?.toString() ?? '',
    message: form.get('message')?.toString() ?? '',
  });
  return toResponse(result, redirect);
};
