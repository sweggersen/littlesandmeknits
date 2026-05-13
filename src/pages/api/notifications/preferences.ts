import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { updatePreferences } from '../../../lib/services/notifications';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const body = await request.json();
  const result = await updatePreferences(ctx, body);
  return toResponse(result);
};
