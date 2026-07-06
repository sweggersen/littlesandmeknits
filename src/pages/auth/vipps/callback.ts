import type { APIRoute } from 'astro';
import { env } from '../../../lib/env';
import { vippsConfig, exchangeCode, fetchUserinfo } from '../../../lib/vipps';
import { signInWithVippsUserinfo } from '../../../lib/vipps-session';
import { createAdminSupabase } from '../../../lib/supabase';
import { safeInternalPath } from '../../../lib/auth';
import { checkRateLimit, clientIp } from '../../../lib/rate-limit';
import { log } from '../../../lib/log';

const STATE_COOKIE = 'vipps_oidc_state';
const VERIFIER_COOKIE = 'vipps_oidc_verifier';
const NEXT_COOKIE = 'vipps_oidc_next';

function clearOidcCookies(cookies: import('astro').AstroCookies) {
  for (const name of [STATE_COOKIE, VERIFIER_COOKIE, NEXT_COOKIE]) {
    cookies.delete(name, { path: '/' });
  }
}

function redirect(location: string): Response {
  // Response.redirect() returns immutable headers; build manually so
  // Astro can merge Set-Cookie headers from the session minting.
  return new Response(null, { status: 302, headers: { Location: location } });
}

function fail(reason: string, detail?: string): Response {
  const params = new URLSearchParams({ error: 'vipps', reason });
  if (detail) params.set('detail', detail.slice(0, 200));
  return redirect(`/login?${params.toString()}`);
}

export const GET: APIRoute = async ({ url, cookies, request }) => {
  // Same per-IP guard as /start, with a slightly tighter window — every
  // callback hit triggers a Stripe-style token exchange + userinfo fetch.
  // Skipped on localhost (shared IP bucket would block dev testing).
  const isLocal = ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);
  const ip = clientIp(request);
  if (!isLocal && !checkRateLimit('vipps.callback', ip, { limit: 20, windowSeconds: 60 })) {
    log.warn('vipps.callback_rate_limited', { ip });
    return new Response('Too many attempts. Please try again in a minute.', {
      status: 429,
      headers: { 'Retry-After': '60' },
    });
  }

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const expectedState = cookies.get(STATE_COOKIE)?.value;
  const verifier = cookies.get(VERIFIER_COOKIE)?.value;
  const next = cookies.get(NEXT_COOKIE)?.value ?? '/studio';
  clearOidcCookies(cookies);

  if (errorParam) return fail(errorParam);
  if (!code || !returnedState || !verifier || returnedState !== expectedState) {
    return fail('state');
  }

  const cfg = vippsConfig(env);
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/auth/vipps/callback`;

  let userinfo;
  try {
    const tokens = await exchangeCode(cfg, { code, redirectUri, codeVerifier: verifier });
    userinfo = await fetchUserinfo(cfg, tokens.access_token);
  } catch (err) {
    log.error('vipps.exchange_failed', { error: err });
    return fail('exchange');
  }

  const result = await signInWithVippsUserinfo({
    userinfo,
    request,
    cookies,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!result.ok) return fail(result.reason ?? 'session', result.detail);

  // Default landing depends on host:
  //   strikketorget.no  -> /market (first-time users detour through welcome)
  //   littlesandmeknits -> /studio (no onboarding gate; goes straight in)
  const isStrikketorget = new URL(request.url).hostname.includes('strikketorget');
  const defaultNext = isStrikketorget ? '/market' : '/studio';
  const safeNext = safeInternalPath(next, defaultNext);

  // We can't use the cookie-bound supabase client here because the session
  // cookies were set on the *response* of signInWithVippsUserinfo and aren't
  // visible on this request yet. Use the admin client (RLS-bypassing) with
  // the userId returned from the signin helper.
  if (isStrikketorget && result.userId) {
    const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: prefs } = await admin
      .from('buyer_preferences')
      .select('strikketorget_welcomed_at')
      .eq('id', result.userId)
      .maybeSingle();
    if (!prefs?.strikketorget_welcomed_at) {
      return redirect(`${origin}/market/velkommen`);
    }
  }

  return redirect(`${origin}${safeNext}`);
};
