import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { unsubscribePush } from '../../../lib/services/push';

export const POST: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const { endpoint } = await request.json();
  const result = await unsubscribePush(ctx, { endpoint: endpoint ?? '' });
  if (!result.ok) return new Response(result.message, { status: result.code === 'bad_input' ? 400 : 500 });
  return new Response('OK');
};
