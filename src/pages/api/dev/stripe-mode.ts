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

  // The fingerprint leaks a few real key bytes, so only staff get it — invite
  // holders get the (non-credential) mode. Even for staff we no longer expose
  // the 12-char prefix (which included 4 secret key chars): the mode marker
  // `sk_live_`/`sk_test_` plus the last 4 is enough to match the dashboard.
  const prefix = key.startsWith('sk_test_') ? 'sk_test_' : key.startsWith('sk_live_') ? 'sk_live_' : '';
  const keyFingerprint = admin && key ? `${prefix}…${key.slice(-4)}` : null;

  return new Response(JSON.stringify({ mode, keyFingerprint }), {
    headers: { 'content-type': 'application/json' },
  });
};
