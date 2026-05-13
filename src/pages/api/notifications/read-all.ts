import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { markAllRead } from '../../../lib/services/notifications';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const result = await markAllRead(ctx, { referer: request.headers.get('referer') ?? undefined });
  return toResponse(result, redirect);
};
