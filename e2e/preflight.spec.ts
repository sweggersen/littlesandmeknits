import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E for the admin launch-preflight (/admin/preflight + /api/admin/preflight):
// the auth gate (admin-only) and that the report renders. The classification
// logic itself is unit-tested in src/lib/services/preflight.test.ts.

const SILJE = 'silje@test.strikketorget.no'; // seeded admin
const LIV = 'liv@test.strikketorget.no';     // seeded non-admin buyer
let adminToken: string;

async function exec(api: APIRequestContext, action: string, body: Record<string, unknown> = {}) {
  const res = await api.post('/api/dev/test-exec', {
    headers: { 'X-Admin-Token': adminToken, 'Content-Type': 'application/json' },
    data: { action, ...body },
  });
  expect(res.ok(), `${action} returned ${res.status()}`).toBeTruthy();
  return res.json();
}

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  const res = await page.request.post('/api/dev/test-login', { data: { email } });
  expect(res.ok(), `login as ${email} failed`).toBeTruthy();
}

test.describe('Admin — lanseringssjekk', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
    await exec(request, 'seed-world'); // creates the personas incl. Silje (admin) + Liv (buyer)
  });

  test.afterAll(async ({ request }) => {
    await exec(request, 'cleanup');
  });

  test('a non-admin is denied the report', async ({ page }) => {
    await loginAs(page, LIV);
    const denied = await page.request.get('/api/admin/preflight');
    expect(denied.status(), 'non-admin endpoint must be 403').toBe(403);

    const resp = await page.goto('/admin/preflight');
    expect(resp?.url(), 'non-admin must be redirected off /admin/preflight')
      .not.toContain('/admin/preflight');
  });

  test('an admin gets a well-formed report with no secret values', async ({ page }) => {
    await loginAs(page, SILJE);

    const json = await (await page.request.get('/api/admin/preflight')).json();
    expect(typeof json.ready).toBe('boolean');
    expect(Array.isArray(json.checks)).toBe(true);
    expect(json.checks.some((c: { key: string }) => c.key === 'STRIPE_SECRET_KEY')).toBe(true);
    // Report must never carry a secret value — only presence/classification.
    expect(JSON.stringify(json)).not.toContain('sk_live_');

    await page.goto('/admin/preflight');
    await expect(page.getByRole('heading', { name: 'Lanseringssjekk' })).toBeVisible();
    await expect(page.getByText(/blokkerende/)).toBeVisible();
  });
});
