import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { requireAdmin } from '../../../lib/admin-auth';

// Returns whether STRIPE_SECRET_KEY currently in the env is in TEST or
// LIVE mode. Useful for verifying which Stripe account a deploy is
// pointing at without having to log into Stripe's dashboard.
//
// Admin-only because while "test"/"live" isn't a credential, knowing
// whether a public-facing site is in live mode is a fingerprint.

export const GET: APIRoute = async ({ request, cookies }) => {
  const admin = await requireAdmin(request, cookies);
  if (!admin) return new Response('Not allowed', { status: 403 });

  const key = env.STRIPE_SECRET_KEY ?? '';
  let mode: 'test' | 'live' | 'unknown' = 'unknown';
  if (key.startsWith('sk_test_')) mode = 'test';
  else if (key.startsWith('sk_live_')) mode = 'live';

  return new Response(JSON.stringify({
    mode,
    // Truncated fingerprint so you can compare against the key shown in
    // your Stripe dashboard without exposing the secret itself.
    keyFingerprint: key ? key.slice(0, 12) + '…' + key.slice(-4) : null,
  }), {
    headers: { 'content-type': 'application/json' },
  });
};
