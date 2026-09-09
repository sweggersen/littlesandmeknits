import { test, expect, type APIRequestContext } from '@playwright/test';

// E2E for the store page-builder (Phase 1): apply a starter preset to a seeded
// store via the real applyPreset service (through the apply-store-preset
// test-exec action), then assert the public storefront renders the themed,
// block-composed layout AND that a store WITHOUT a page_config still renders the
// original storefront (the fallback).

const OWNER = 'builder-owner@test.strikketorget.no';

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

test.describe('Strikketorget — butikk-bygger', () => {
  test.beforeAll(async ({ request }) => {
    const r = await request.get('/api/dev/test-token');
    expect(r.ok(), 'could not fetch admin token').toBeTruthy();
    adminToken = (await r.json()).token;
  });

  test('applies a preset and renders a themed, block-composed storefront', async ({ page, request }) => {
    const slug = `builder-e2e-${Date.now().toString(36)}`;
    const seeded = await exec(request, 'seed-store', {
      actor: OWNER,
      params: { slug, name: 'Fjellgarn Strikk' },
    });
    const storeId = seeded.data.storeId as string;

    await exec(request, 'apply-store-preset', {
      actor: OWNER,
      params: { store_id: storeId, preset_id: 'varm-klassisk' },
    });

    await page.goto(`/market/store/${slug}`);

    // (a) Themed blocks render: the hero heading (store name) + a product grid.
    const scope = page.locator('[data-store-scope]');
    await expect(scope).toBeVisible();
    await expect(page.locator('[data-block-type="hero"] h1')).toHaveText('Fjellgarn Strikk');
    await expect(page.locator('[data-block-type="productGrid"]')).toBeVisible();
    await expect(page.locator('[data-block-type="productGrid"] h2')).toContainText('Annonser');

    // (b) The storefront root carries the preset's theme CSS variables.
    const style = (await scope.getAttribute('style')) ?? '';
    expect(style).toContain('--color-primary:#C06A45'); // varm-klassisk primary
    expect(style).toContain('--font-display:"Fraunces Variable"');

    // (c) The owner ("Eier") panel renders on the builder storefront, and it
    // lives INSIDE the themed scope so it reskins with the store theme.
    const ownerHeading = page.getByRole('heading', { name: 'Eier' });
    await expect(ownerHeading).toBeVisible();
    await expect(scope.getByRole('heading', { name: 'Eier' })).toHaveCount(1);

    // (d) A store-report control sits at the bottom of the page.
    await expect(page.getByRole('button', { name: 'Rapporter denne butikken' })).toBeVisible();
  });

  test('a store WITHOUT a page_config renders the platform default (themed pipeline)', async ({ page, request }) => {
    const slug = `plain-e2e-${Date.now().toString(36)}`;
    await exec(request, 'seed-store', {
      actor: OWNER,
      params: { slug, name: 'Uten Tema' },
    });

    await page.goto(`/market/store/${slug}`);

    // Every store renders through the ONE themed pipeline: an empty config falls
    // back to the platform default (hero with the store name + a product grid),
    // so the builder scope IS present.
    await expect(page.locator('[data-store-scope]')).toBeVisible();
    await expect(page.locator('[data-block-type="hero"] h1')).toHaveText('Uten Tema');
    await expect(page.getByRole('heading', { name: 'Annonser' })).toBeVisible();
  });
});
