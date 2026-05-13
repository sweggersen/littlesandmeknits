import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../lib/services/context';
import { getMe } from '../../lib/services/profile';

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
