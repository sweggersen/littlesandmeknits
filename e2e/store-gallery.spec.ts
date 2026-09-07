import { test, expect, type APIRequestContext } from '@playwright/test';

// E2E for the two new store page-builder blocks:
//   - hero with a background image + adjustable dark overlay + logo (#6/#8)
//   - imageGallery: square thumbnails that open the listing-style carousel (#7)
// A dev-only test-exec action seeds store_assets + a page_config referencing
// them; we then load the public storefront and assert both blocks render and
// the gallery lightbox opens on click.

const OWNER = 'gallery-owner@test.strikketorget.no';

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

test.describe('Strikketorget — hero-bilde + bildegalleri', () => {
  test.beforeAll(async ({ request }) => {
    const r = await request.get('/api/dev/test-token');
    expect(r.ok(), 'could not fetch admin token').toBeTruthy();
    adminToken = (await r.json()).token;
  });

  test('renders a hero with bg image + overlay + logo and an image gallery carousel', async ({ page, request }) => {
    const slug = `gallery-e2e-${Date.now().toString(36)}`;
    const seeded = await exec(request, 'seed-store', {
      actor: OWNER,
      params: { slug, name: 'Galleri Strikk' },
    });
    const storeId = seeded.data.storeId as string;

    await exec(request, 'seed-store-gallery', { actor: OWNER, params: { store_id: storeId } });

    await page.goto(`/market/store/${slug}`);

    // Builder scope + hero.
    await expect(page.locator('[data-store-scope]')).toBeVisible();
    const hero = page.locator('[data-block-type="hero"]');
    await expect(hero.locator('h1')).toHaveText('Galleri Strikk');

    // (#6) Background image layer + (#8) logo both present.
    await expect(hero.locator('[data-hero-bg]')).toHaveCount(1);
    await expect(hero.locator('[data-hero-logo]')).toHaveCount(1);

    // (#6) Dark overlay applied, built as a validated gradient (not a user string).
    const overlay = hero.locator('[data-hero-overlay]');
    await expect(overlay).toHaveCount(1);
    const overlayStyle = (await overlay.getAttribute('style')) ?? '';
    expect(overlayStyle).toContain('linear-gradient');
    expect(overlayStyle).toContain('rgba(0,0,0,');

    // (#7) Gallery: five square thumbnails.
    const gallery = page.locator('[data-block-type="imageGallery"]');
    await expect(gallery.locator('h2')).toContainText('Fra verkstedet');
    const thumbs = gallery.locator('[data-gallery-thumb]');
    await expect(thumbs).toHaveCount(5);

    // Lightbox starts hidden, opens on click, and closes with the close button.
    const lightbox = gallery.locator('[data-gallery-lightbox]');
    await expect(lightbox).toBeHidden();
    await thumbs.first().click();
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('[data-gallery-img]')).toHaveJSProperty('tagName', 'IMG');
    await expect(lightbox.locator('[data-gallery-counter]')).toContainText('1 / 5');
    await lightbox.locator('[data-gallery-next]').click();
    await expect(lightbox.locator('[data-gallery-counter]')).toContainText('2 / 5');
    await lightbox.locator('[data-gallery-close]').click();
    await expect(lightbox).toBeHidden();
  });
});
