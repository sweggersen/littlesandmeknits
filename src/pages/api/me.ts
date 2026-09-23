import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../lib/services/context';
import { getMe } from '../../lib/services/profile';
import { log } from '../../lib/log';

export const GET: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) {
    return new Response(JSON.stringify({ user: null }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
    });
  }

  const result = await getMe(ctx);
  if (!result.ok) {
    // A DB failure here would otherwise be indistinguishable from logged-out on
    // this navbar hot path. Surface it (still degrade to {user:null} for the UI).
    log.error('me.get_failed', { code: result.code, message: result.message, userId: ctx.user.id });
    return new Response(JSON.stringify({ user: null }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
    });
  }

  return new Response(JSON.stringify({ user: result.data }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  });
};
