import { test, expect } from '@playwright/test';
import { PERSONAS } from '../src/lib/dev/scenarios';

// Token-auth JSON API (/api/v1/*) — the pre-mobile foundation. Proves that a
// Supabase access token in `Authorization: Bearer <jwt>` (no cookies)
// authenticates the same service layer the web uses, and that RLS runs as that
// user. If this passes, a mobile client can drive the platform over JSON.

const BUYER = PERSONAS.liv.email;

test.describe('/api/v1 token auth', () => {
  test('Bearer token resolves the user via /api/v1/me', async ({ playwright, baseURL, request }) => {
    const login = await request.post('/api/dev/test-login', { data: { email: BUYER } });
    const { user_id, access_token } = await login.json();
    expect(access_token, 'test-login returns an access token').toBeTruthy();

    // Fresh context => no sb-auth cookie, so auth can ONLY come from the Bearer
    // header. This is exactly the mobile client's situation.
    const clean = await playwright.request.newContext({ baseURL });
    const me = await clean.get('/api/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.user.id).toBe(user_id);
    // RLS ran as this user: they can read their own profile row.
    expect(body.profile?.id).toBe(user_id);
    await clean.dispose();
  });

  test('no token → 401 JSON', async ({ request }) => {
    const me = await request.get('/api/v1/me');
    expect(me.status()).toBe(401);
    expect((await me.json()).error).toBe('unauthorized');
  });

  test('garbage token → 401 JSON', async ({ request }) => {
    const me = await request.get('/api/v1/me', {
      headers: { Authorization: 'Bearer not-a-real-jwt' },
    });
    expect(me.status()).toBe(401);
  });

  test('money endpoints reject an anonymous caller with JSON', async ({ request }) => {
    // No Bearer, no cookie → 401 JSON (not an HTML redirect the mobile client
    // would choke on).
    const buy = await request.post('/api/v1/listings/00000000-0000-0000-0000-000000000000/buy');
    expect(buy.status()).toBe(401);
    expect(buy.headers()['content-type']).toContain('application/json');
  });
});
