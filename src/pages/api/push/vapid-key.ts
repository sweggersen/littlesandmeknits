import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  const key = import.meta.env.PUBLIC_VAPID_KEY;
  if (!key) return new Response('Not configured', { status: 503 });
  return new Response(JSON.stringify({ publicKey: key }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
