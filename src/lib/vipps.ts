// Vipps Login (OIDC) — config + small helpers.
//
// Vipps issues a stable `sub` claim per merchant on the ID token, plus a
// userinfo endpoint returning name/phone/email/address. We use sub as the
// durable link between a Vipps identity and our Supabase user.
//
// Test base:  https://apitest.vipps.no
// Prod base:  https://api.vipps.no

export interface VippsConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
  msn: string;
}

export function vippsConfig(env: {
  VIPPS_ENV?: string;
  VIPPS_CLIENT_ID?: string;
  VIPPS_CLIENT_SECRET?: string;
  VIPPS_SUBSCRIPTION_KEY?: string;
  VIPPS_MSN?: string;
}): VippsConfig {
  const isProd = env.VIPPS_ENV === 'prod';
  return {
    baseUrl: isProd ? 'https://api.vipps.no' : 'https://apitest.vipps.no',
    clientId: env.VIPPS_CLIENT_ID ?? '',
    clientSecret: env.VIPPS_CLIENT_SECRET ?? '',
    subscriptionKey: env.VIPPS_SUBSCRIPTION_KEY ?? '',
    msn: env.VIPPS_MSN ?? '',
  };
}

// Base64-url (no padding) — used for PKCE verifier hash.
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(byteLen = 32): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

export function authorizationUrl(cfg: VippsConfig, params: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
}): string {
  const u = new URL(`${cfg.baseUrl}/access-management-1.0/access/oauth2/auth`);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('scope', params.scope ?? 'openid name phoneNumber email address');
  u.searchParams.set('state', params.state);
  u.searchParams.set('code_challenge', params.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export interface VippsTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
}

export async function exchangeCode(cfg: VippsConfig, params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<VippsTokenResponse> {
  const basic = btoa(`${cfg.clientId}:${cfg.clientSecret}`);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  const res = await fetch(`${cfg.baseUrl}/access-management-1.0/access/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
      'Merchant-Serial-Number': cfg.msn,
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vipps token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<VippsTokenResponse>;
}

export interface VippsUserinfo {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  phone_number?: string;
  address?: {
    street_address?: string;
    postal_code?: string;
    region?: string;
    country?: string;
    formatted?: string;
  };
  birthdate?: string;
}

export async function fetchUserinfo(cfg: VippsConfig, accessToken: string): Promise<VippsUserinfo> {
  const res = await fetch(`${cfg.baseUrl}/vipps-userinfo-api/userinfo`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
      'Merchant-Serial-Number': cfg.msn,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vipps userinfo failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<VippsUserinfo>;
}

// Decode the ID token to read `sub` without verifying — we don't trust this
// alone, but it's a quick way to get the subject when needed. Userinfo also
// includes sub, so this is rarely needed in practice.
export function decodeIdTokenSub(idToken: string): string | null {
  try {
    const [, payload] = idToken.split('.');
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const obj = JSON.parse(json) as { sub?: string };
    return obj.sub ?? null;
  } catch {
    return null;
  }
}
