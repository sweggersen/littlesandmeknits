import type { APIRoute } from 'astro';
import { env } from '../../../lib/env';

// Returns the daily HMAC admin token used to authenticate /api/dev/test-exec
// from Playwright tests. Localhost-only.
export const GET: APIRoute = async ({ request }) => {
  if (import.meta.env.PROD) return new Response('Not available', { status: 403 });
  const host = new URL(request.url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.workers.dev')) {
    return new Response('Not available', { status: 403 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Service role key not configured', { status: 503 });
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.SUPABASE_SERVICE_ROLE_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const today = new Date().toISOString().slice(0, 10);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`admin-tower-${today}`));
  const token = btoa(String.fromCharCode(...new Uint8Array(sig))).slice(0, 43);

  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
