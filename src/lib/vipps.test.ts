import { describe, it, expect } from 'vitest';
import { vippsConfig, pkceChallenge, authorizationUrl, decodeIdTokenSub } from './vipps';

describe('vippsConfig', () => {
  it('uses test base by default', () => {
    const cfg = vippsConfig({ VIPPS_CLIENT_ID: 'a', VIPPS_CLIENT_SECRET: 'b', VIPPS_SUBSCRIPTION_KEY: 'c', VIPPS_MSN: '1' });
    expect(cfg.baseUrl).toBe('https://apitest.vipps.no');
  });

  it('uses prod base when VIPPS_ENV=prod', () => {
    const cfg = vippsConfig({ VIPPS_ENV: 'prod', VIPPS_CLIENT_ID: 'a', VIPPS_CLIENT_SECRET: 'b', VIPPS_SUBSCRIPTION_KEY: 'c', VIPPS_MSN: '1' });
    expect(cfg.baseUrl).toBe('https://api.vipps.no');
  });
});

describe('pkceChallenge', () => {
  it('produces a deterministic base64url SHA-256 hash', async () => {
    // RFC 7636 Appendix B test vector
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(await pkceChallenge(verifier)).toBe(expected);
  });
});

describe('authorizationUrl', () => {
  it('includes required OIDC params', () => {
    const u = new URL(
      authorizationUrl(
        { baseUrl: 'https://apitest.vipps.no', clientId: 'cid', clientSecret: '', subscriptionKey: '', msn: '' },
        { redirectUri: 'https://x/cb', state: 's1', codeChallenge: 'ch' },
      ),
    );
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('redirect_uri')).toBe('https://x/cb');
    expect(u.searchParams.get('state')).toBe('s1');
    expect(u.searchParams.get('code_challenge')).toBe('ch');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toContain('openid');
  });
});

describe('decodeIdTokenSub', () => {
  it('extracts sub from a well-formed JWT', () => {
    const payload = btoa(JSON.stringify({ sub: 'vipps-abc-123' }));
    const jwt = `header.${payload.replace(/=+$/, '')}.sig`;
    expect(decodeIdTokenSub(jwt)).toBe('vipps-abc-123');
  });

  it('returns null on malformed input', () => {
    expect(decodeIdTokenSub('not-a-jwt')).toBeNull();
    expect(decodeIdTokenSub('')).toBeNull();
  });
});
