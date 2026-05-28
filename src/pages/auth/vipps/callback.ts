import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { vippsConfig, exchangeCode, fetchUserinfo } from '../../../lib/vipps';
import { signInWithVippsUserinfo } from '../../../lib/vipps-session';

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

function fail(reason: string): Response {
  const params = new URLSearchParams({ error: 'vipps', reason });
  return redirect(`/login?${params.toString()}`);
}

export const GET: APIRoute = async ({ url, cookies, request }) => {
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
    console.error('Vipps token/userinfo error', err);
    return fail('exchange');
  }

  const result = await signInWithVippsUserinfo({
    userinfo,
    request,
    cookies,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!result.ok) return fail(result.reason ?? 'session');

  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/studio';
  return redirect(`${origin}${safeNext}`);
};
