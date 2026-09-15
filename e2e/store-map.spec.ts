import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E for the Butikker "Kart" view: the Liste/Kart toggle switches the
// directory to an interactive Leaflet map that plots located stores at their
// (exact, for businesses) coordinates. Overlapping stores collapse into a
// branded numbered cluster that spiderfies on click. Tiles are external
// (skipped in CI's offline mode) but Leaflet init + markers don't need them —
// the map signals readiness via data-store-map-ready/-fitted.

const OWNER = 'sm-e2e-owner@test.strikketorget.no';
const BUYER = 'sm-e2e-buyer@test.strikketorget.no';
const STAMP = Date.now().toString(36);
// One store far from anything (a standalone marker, for a deterministic popup
// click) and two at an identical remote point (guaranteed to form a cluster).
const REMOTE = `sm-remote-${STAMP}`;
const PAIR_A = `sm-pair-a-${STAMP}`;
const PAIR_B = `sm-pair-b-${STAMP}`;
const PAIR_LAT = 61.5;
const PAIR_LNG = 9.1;

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

async function dismissConsent(page: Page) {
  const consent = page.getByRole('button', { name: 'Greit, takk' });
  if (await consent.isVisible().catch(() => false)) await consent.click();
}

/** Drill into clusters (zoom-in / spiderfy) until individual store pins surface.
 *  Geography-independent: works regardless of which stores cluster at the
 *  fitted zoom (accumulated local seeds make that unpredictable). */
async function revealPins(page: Page): Promise<void> {
  for (let i = 0; i < 8; i++) {
    if ((await page.locator('.store-map-pin').count()) > 0) return;
    const cluster = page.locator('.store-map-cluster').first();
    if ((await cluster.count()) === 0) return;
    await cluster.click({ force: true });
    await page.waitForTimeout(500);
  }
}

test.describe('Strikketorget — Butikker kartvisning', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
    await request.post('/api/dev/test-login', { data: { email: BUYER } });
    await exec(request, 'seed-store', {
      actor: OWNER,
      params: { slug: REMOTE, name: `Kart Remote ${STAMP}`, location_city: 'Hammerfest', postnummer: '9600', lat: 70.66, lng: 23.68 },
    });
    await exec(request, 'seed-store', {
      actor: OWNER,
      params: { slug: PAIR_A, name: `Kart Par A ${STAMP}`, location_city: 'Vinstra', postnummer: '2640', lat: PAIR_LAT, lng: PAIR_LNG },
    });
    await exec(request, 'seed-store', {
      actor: OWNER,
      params: { slug: PAIR_B, name: `Kart Par B ${STAMP}`, location_city: 'Vinstra', postnummer: '2640', lat: PAIR_LAT, lng: PAIR_LNG },
    });
  });

  test('Kart toggle renders a Leaflet map with markers', async ({ page }) => {
    await loginAs(page, BUYER);
    await page.goto('/market/stores');

    const kartTab = page.getByRole('link', { name: 'Kart', exact: true });
    await expect(kartTab).toBeVisible();
    await kartTab.click();
    await expect(page).toHaveURL(/vis=kart/);

    const map = page.locator('[data-store-map]');
    await expect(map).toBeVisible();
    await expect(map).toHaveAttribute('data-store-map-fitted', '1', { timeout: 10_000 });

    // Seeded stores are in the marker payload; markers/clusters are drawn.
    const payload = await page.locator('[data-store-map-data]').textContent();
    expect(payload).toContain(`Kart Remote ${STAMP}`);
    expect(payload).toContain(`Kart Par A ${STAMP}`);
    expect(await page.locator('.leaflet-marker-icon').count()).toBeGreaterThanOrEqual(2);
  });

  test('overlapping stores collapse into a cluster; drilling in reveals pins', async ({ page }) => {
    await loginAs(page, BUYER);
    await page.goto('/market/stores?vis=kart');
    await dismissConsent(page);

    const map = page.locator('[data-store-map]');
    await expect(map).toHaveAttribute('data-store-map-fitted', '1', { timeout: 10_000 });

    // With many co-located stores seeded, at least one branded cluster badge
    // shows on the country-wide view.
    await expect(page.locator('.store-map-cluster').first()).toBeVisible();

    // Clicking clusters zooms in / spiderfies until individual store pins show.
    await revealPins(page);
    expect(await page.locator('.store-map-pin').count()).toBeGreaterThan(0);
  });

  test('a store pin opens a popup linking to the store', async ({ page }) => {
    await loginAs(page, BUYER);
    await page.goto('/market/stores?vis=kart');
    await dismissConsent(page);

    const map = page.locator('[data-store-map]');
    await expect(map).toHaveAttribute('data-store-map-fitted', '1', { timeout: 10_000 });

    await revealPins(page);
    const pin = page.locator('.store-map-pin').first();
    await expect(pin).toBeVisible({ timeout: 10_000 });
    await pin.click({ force: true });

    const popupLink = page.locator('.store-map-popup__name').first();
    await expect(popupLink).toBeVisible();
    await expect(popupLink).toHaveAttribute('href', /\/market\/store\//);
  });

  test('map re-fits after navigating to a store and back', async ({ page }) => {
    await loginAs(page, BUYER);
    await page.goto('/market/stores?vis=kart');
    const map = page.locator('[data-store-map]');
    await expect(map).toHaveAttribute('data-store-map-fitted', '1', { timeout: 10_000 });

    // Navigate into a store, then use the browser back button (a ClientRouter
    // swap that animates via transform — the case that left a single tile).
    await page.goto(`/market/store/${REMOTE}`);
    await expect(page.locator('h1, [data-block-type]').first()).toBeVisible();
    await page.goBack();

    const back = page.locator('[data-store-map]');
    await expect(back).toHaveAttribute('data-store-map-fitted', '1', { timeout: 10_000 });
    expect(await page.locator('.leaflet-tile-loaded, .leaflet-tile').count()).toBeGreaterThan(1);
  });

  test('Liste toggle returns to the grid', async ({ page }) => {
    await loginAs(page, BUYER);
    await page.goto('/market/stores?vis=kart');
    await page.getByRole('link', { name: 'Liste', exact: true }).click();
    await expect(page).not.toHaveURL(/vis=kart/);
    await expect(page.locator('[data-store-map]')).toHaveCount(0);
  });
});
