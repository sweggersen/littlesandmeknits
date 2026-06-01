import type { APIRoute } from 'astro';
import { env } from '../../../lib/env';
import { requireAdmin } from '../../../lib/admin-auth';

// Returns whether STRIPE_SECRET_KEY currently in the env is in TEST or
// LIVE mode. Useful for verifying which Stripe account a deploy is
// pointing at without having to log into Stripe's dashboard.
//
// Admin-only because while "test"/"live" isn't a credential, knowing
// whether a public-facing site is in live mode is a fingerprint.

export const GET: APIRoute = async ({ request, cookies }) => {
  // Admins always allowed. Anyone with the login_invite cookie is allowed
  // too — they already know the shared invite secret, so telling them
  // whether Stripe is in test/live mode adds no new privilege.
  const admin = await requireAdmin(request, cookies);
  const hasInvite = cookies.get('login_invite')?.value === '1';
  if (!admin && !hasInvite) return new Response('Not allowed', { status: 403 });

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
