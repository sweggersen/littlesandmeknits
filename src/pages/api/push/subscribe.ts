import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { subscribePush } from '../../../lib/services/push';

export const POST: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const { endpoint, keys } = await request.json();
  const result = await subscribePush(ctx, {
    endpoint: endpoint ?? '',
    p256dh: keys?.p256dh ?? '',
    auth: keys?.auth ?? '',
  });
  if (!result.ok) return new Response(result.message, { status: result.code === 'bad_input' ? 400 : 500 });
  return new Response('OK');
};
