import type { APIRoute } from 'astro';
import { env } from '../../../lib/env';
import { vippsConfig, randomToken, pkceChallenge, authorizationUrl } from '../../../lib/vipps';
import { checkRateLimit, clientIp } from '../../../lib/rate-limit';
import { safeInternalPath } from '../../../lib/auth';
import { log } from '../../../lib/log';

// Cookie names — short-lived, signed by being random + httpOnly.
const STATE_COOKIE = 'vipps_oidc_state';
const VERIFIER_COOKIE = 'vipps_oidc_verifier';
const NEXT_COOKIE = 'vipps_oidc_next';

export const GET: APIRoute = async ({ url, cookies, request }) => {
  // Per-IP rate limit. Each Vipps start spins up a session at Vipps' side
  // and consumes a tiny bit of credential. 10 attempts/minute is plenty
  // for any real user (an accidental refresh loop won't reach it). Skipped on
  // localhost, where every request shares one IP bucket and would block dev
  // testing (and the dev quick-login on /login is the real path anyway).
  const isLocal = ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);
  const ip = clientIp(request);
  if (!isLocal && !checkRateLimit('vipps.start', ip, { limit: 10, windowSeconds: 60 })) {
    log.warn('vipps.start_rate_limited', { ip });
    return new Response('Too many attempts. Please try again in a minute.', {
      status: 429,
      headers: { 'Retry-After': '60' },
    });
  }

  // Public signup is gated — must have the invite cookie set by visiting
  // /login?invite=<key>. Without it, bounce to the interest form.
  if (cookies.get('login_invite')?.value !== '1') {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }

  const cfg = vippsConfig(env);
  if (!cfg.clientId || !cfg.clientSecret || !cfg.subscriptionKey || !cfg.msn) {
    return new Response('Vipps Login is not configured', { status: 500 });
  }

  // Validate before storing so a poisoned cookie can't carry an external
  // target into the callback (the callback re-validates too, defense in depth).
  const next = safeInternalPath(url.searchParams.get('next'), '/studio');
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
