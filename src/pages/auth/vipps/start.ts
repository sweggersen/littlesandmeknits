import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { vippsConfig, randomToken, pkceChallenge, authorizationUrl } from '../../../lib/vipps';

// Cookie names — short-lived, signed by being random + httpOnly.
const STATE_COOKIE = 'vipps_oidc_state';
const VERIFIER_COOKIE = 'vipps_oidc_verifier';
const NEXT_COOKIE = 'vipps_oidc_next';

export const GET: APIRoute = async ({ url, cookies, request }) => {
  // Public signup is gated — must have the invite cookie set by visiting
  // /login?invite=<key>. Without it, bounce to the interest form.
  if (cookies.get('login_invite')?.value !== '1') {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }

  const cfg = vippsConfig(env);
  if (!cfg.clientId || !cfg.clientSecret || !cfg.subscriptionKey || !cfg.msn) {
    return new Response('Vipps Login is not configured', { status: 500 });
  }

  const next = url.searchParams.get('next') ?? '/studio';
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = await pkceChallenge(verifier);

  // Compute the redirect URI from the current request origin so dev (localhost)
  // and prod (littlesandmeknits.com) both work without hardcoding.
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/auth/vipps/callback`;

  const cookieOpts = {
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 10, // 10 minutes
  };
  cookies.set(STATE_COOKIE, state, cookieOpts);
  cookies.set(VERIFIER_COOKIE, verifier, cookieOpts);
  cookies.set(NEXT_COOKIE, next, cookieOpts);

  const authUrl = authorizationUrl(cfg, {
    redirectUri,
    state,
    codeChallenge: challenge,
  });
  return new Response(null, { status: 302, headers: { Location: authUrl } });
};
