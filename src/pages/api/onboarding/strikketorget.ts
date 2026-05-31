import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { completeStrikketorgetWelcome } from '../../../lib/services/profile';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const action = String(form.get('action') ?? 'save') === 'skip' ? 'skip' : 'save';
  const interests = form.getAll('interests').map((v) => String(v));

  const result = await completeStrikketorgetWelcome(ctx, { action, interests });
  return toResponse(result, redirect);
};
