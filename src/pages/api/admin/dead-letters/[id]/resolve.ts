import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../lib/services/context';
import { resolveDeadLetter } from '../../../../../lib/services/dead-letter';
import { toResponse } from '../../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const result = await resolveDeadLetter(ctx, {
    eventId: params.id ?? '',
    note: String(form.get('note') ?? '').trim() || null,
  });
  return toResponse(result, redirect);
};
