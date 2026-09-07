import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E for the Phase 2 store editor ("Butikk-lekeplass"): as a store editor,
// open the editor, add a block, edit a text prop + a theme colour, save +
// publish, then load the public storefront and assert the change is LIVE
// (block present + the theme CSS var reflects the new colour). Also asserts a
// visitor never sees the draft before publish.

const OWNER = 'store-editor@test.strikketorget.no';
const NEW_PRIMARY = '#AB12CD';

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
  expect(res.ok(), `login as ${email} failed: ${await res.text()}`).toBeTruthy();
}

test.describe('Strikketorget — butikk-editor', () => {
  test.beforeAll(async ({ request }) => {
    const r = await request.get('/api/dev/test-token');
    expect(r.ok(), 'could not fetch admin token').toBeTruthy();
    adminToken = (await r.json()).token;
  });

  test('edit + publish a block and theme colour, then it is live', async ({ page, request }) => {
    const slug = `editor-e2e-${Date.now().toString(36)}`;
    const heading = `Om oss ${Date.now().toString(36)}`;

    await exec(request, 'seed-store', { actor: OWNER, params: { slug, name: 'Editor Strikk' } });
    await loginAs(page, OWNER);

    // Open the editor (guarded to branding editors).
    await page.goto(`/market/store/${slug}/admin/butikk`);
    await expect(page.locator('[data-store-editor][data-hydrated="1"]')).toBeVisible();

    // Add a text section block; it auto-selects, so the property panel shows it.
    await page.locator('[data-add-block="textSection"]').click();
    const headingInput = page.locator('[data-prop="heading"]');
    await expect(headingInput).toBeVisible();
    await headingInput.fill(heading);

    // Change the primary theme colour via the hex text input.
    await page.locator('[data-color-hex="primary"]').fill(NEW_PRIMARY);

    // Save the draft, then publish.
    await page.locator('[data-save]').click();
    await expect(page.locator('[data-save]')).toHaveText('Lagret');

    // Before publish: a fresh visitor still sees the default storefront (no
    // builder scope), proving the draft doesn't leak.
    const visitor = await page.context().browser()!.newContext();
    const visitorPage = await visitor.newPage();
    await visitorPage.goto(`/market/store/${slug}`);
    await expect(visitorPage.locator('[data-store-scope]')).toHaveCount(0);
    await visitor.close();

    await page.locator('[data-publish]').click();
    await expect(page.locator('[data-publish]')).toHaveText('Publisert');

    // Public storefront now renders the themed builder layout with our block.
    await page.goto(`/market/store/${slug}`);
    const scope = page.locator('[data-store-scope]');
    await expect(scope).toBeVisible();
    await expect(page.locator('[data-block-type="textSection"] h2')).toHaveText(heading);

    const style = (await scope.getAttribute('style')) ?? '';
    expect(style).toContain(`--color-primary:${NEW_PRIMARY}`);
  });

  test('draft preview shows unpublished edits to the editor only', async ({ page, request }) => {
    const slug = `editor-preview-${Date.now().toString(36)}`;
    await exec(request, 'seed-store', { actor: OWNER, params: { slug, name: 'Preview Strikk' } });
    await loginAs(page, OWNER);

    await page.goto(`/market/store/${slug}/admin/butikk`);
    await expect(page.locator('[data-store-editor][data-hydrated="1"]')).toBeVisible();
    await page.locator('[data-add-block="hero"]').click();
    await page.locator('[data-save]').click();
    await expect(page.locator('[data-save]')).toHaveText('Lagret');

    // Owner can preview the unpublished draft.
    await page.goto(`/market/store/${slug}?preview=draft`);
    await expect(page.locator('[data-store-scope]')).toBeVisible();
    await expect(page.locator('[data-block-type="hero"]')).toBeVisible();

    // But the live storefront is still the default (nothing published).
    await page.goto(`/market/store/${slug}`);
    await expect(page.locator('[data-store-scope]')).toHaveCount(0);
  });
});
