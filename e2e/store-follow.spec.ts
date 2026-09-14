import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E for the storeActions block (favourite + follow) on the storefront: a
// non-member gets functional controls (follow → "Følger"); a store member sees
// the same block as a non-interactive preview (following your own store is
// meaningless). The block is part of the store's default design.

const OWNER = 'sf-e2e-owner@test.strikketorget.no';
const BUYER = 'sf-e2e-buyer@test.strikketorget.no';
// Unique per run so a rerun doesn't collide on the slug (seed-store has no cleanup).
const SLUG = `sf-e2e-butikk-${Date.now().toString(36)}`;

let adminToken: string;

async function exec(api: APIRequestContext, action: string, body: Record<string, unknown> = {}) {
  const res = await api.post('/api/dev/test-exec', {
    headers: { 'X-Admin-Token': adminToken, 'Content-Type': 'application/json' },
    data: { action, ...body },
  });
  expect(res.ok(), `${action} returned ${res.status()}`).toBeTruthy();
  const json = await res.json();
  expect(json.ok, `${action} failed: ${json.error}`).toBeTruthy();
  return json;
}

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  const res = await page.request.post('/api/dev/test-login', { data: { email } });
  expect(res.ok(), `login ${email} failed`).toBeTruthy();
}

test.describe('Strikketorget — storeActions block (favoritt + følg)', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
    await request.post('/api/dev/test-login', { data: { email: BUYER } });
    await exec(request, 'seed-store', { actor: OWNER, params: { slug: SLUG, name: 'Følg E2E' } });
  });

  test('non-member can follow the store from the block', async ({ page }) => {
    await loginAs(page, BUYER);
    await page.goto(`/market/store/${SLUG}`);

    const follow = page.locator('[data-store-follow]');
    await expect(follow).toBeVisible();
    await expect(follow).toHaveText(/Følg butikk/);

    await follow.click();
    await expect(follow).toHaveText(/Følger/);
    await expect(follow).toHaveAttribute('aria-pressed', 'true');

    // Persists across reload.
    await page.reload();
    await expect(page.locator('[data-store-follow]')).toHaveText(/Følger/);
  });

  test('a store member sees the block as a non-interactive preview', async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto(`/market/store/${SLUG}`);

    // The block renders (part of the design) with the label, but carries no
    // functional follow hook for the owner.
    await expect(page.locator('[data-block-type="storeActions"]')).toBeVisible();
    await expect(page.getByText('+ Følg butikk')).toBeVisible();
    await expect(page.locator('[data-store-follow]')).toHaveCount(0);
  });
});
