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

    // The follow controls render (part of the design, inside the infoColumns
    // section) with the label, but carry no functional follow hook for the owner.
    await expect(page.getByText('+ Følg butikk')).toBeVisible();
    await expect(page.locator('[data-store-follow]')).toHaveCount(0);
  });
});

test.describe('Strikketorget — infoColumns (om + sidefelt)', () => {
  let token: string;
  const O = 'ic-e2e-owner@test.strikketorget.no';
  const V = 'ic-e2e-viewer@test.strikketorget.no';
  const S = `ic-e2e-${Date.now().toString(36)}`;

  test.beforeAll(async ({ request }) => {
    token = (await (await request.get('/api/dev/test-token')).json()).token;
    await request.post('/api/dev/test-login', { data: { email: V } });
    // seed-store applies the default page (which now uses the infoColumns section).
    const res = await request.post('/api/dev/test-exec', {
      headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
      data: { action: 'seed-store', actor: O, params: { slug: S, name: 'Info E2E' } },
    });
    expect((await res.json()).ok).toBeTruthy();
  });

  test('renders the two-column section: about + contact + follow', async ({ page }) => {
    await page.context().clearCookies();
    await page.request.post('/api/dev/test-login', { data: { email: V } });
    await page.goto(`/market/store/${S}`);
    const section = page.locator('[data-block-type="infoColumns"]');
    await expect(section).toBeVisible();
    // Main column heading + the right-rail contact + follow.
    await expect(section.getByText('Kontakt')).toBeVisible();
    await expect(section.locator('[data-store-follow]')).toBeVisible();
    await expect(section.locator('[data-store-fav]')).toBeVisible();
  });
});
