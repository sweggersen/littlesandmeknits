import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E smoke for the profile dashboard (/profile — the "Command Center" layout).
// Seeds a rich profile, then asserts the page renders its sections for a logged-
// in user.

const ELINE = 'eline@test.strikketorget.no';
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
  await page.request.post('/api/dev/test-login', { data: { email } });
}

test.describe('Profile dashboard', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
    await exec(request, 'cleanup');
    await exec(request, 'set-profile-visible', { actor: ELINE });
    // Fill Eline's dashboard so the variants render against non-empty data
    // (also exercises the seed-profile dev action).
    await exec(request, 'seed-profile', { actor: ELINE });
  });

  test.afterAll(async ({ request }) => {
    await exec(request, 'cleanup');
  });

  test('dashboard loads with its stat cards + sections', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile');
    // Stat cards live in the (locked) stats widget; scope there since these
    // labels also appear as optional-panel headings / feed rows elsewhere.
    const statsWidget = page.locator('.dash-widget[data-widget="stats"]');
    await expect(statsWidget.getByText('Uleste meldinger')).toBeVisible();
    await expect(statsWidget.getByText('Kjøpte oppskrifter')).toBeVisible();
    // Sections.
    await expect(page.getByRole('heading', { name: 'Trenger oppmerksomhet' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Prosjekter' })).toBeVisible();
  });

  test('renders the seeded data', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile');
    // A seeded listing and store show up.
    await expect(page.getByText('Babygenser i merinoull')).toBeVisible();
    await expect(page.getByText('Min Strikkebutikk')).toBeVisible();
  });

  test('Rediger: resizing a widget persists across reload', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Rediger' }).click();
    await expect(page.getByRole('button', { name: 'Lagre' })).toBeVisible();

    const widget = page.locator('.dash-widget[data-widget="needsAttention"]');
    await expect(widget).toHaveAttribute('data-size', 'm');
    await widget.locator('.dash-size[data-size="l"]').click();
    await expect(widget).toHaveAttribute('data-size', 'l');
    await expect(widget.locator('.dash-size[data-size="l"]')).toHaveClass(/is-active/);

    await page.getByRole('button', { name: 'Lagre' }).click();
    await page.reload();
    await expect(page.locator('.dash-widget[data-widget="needsAttention"]')).toHaveAttribute('data-size', 'l');
  });

  test('Rediger: layout persists server-side (survives a localStorage wipe)', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Rediger' }).click();
    const widget = page.locator('.dash-widget[data-widget="snarveier"]');
    await widget.locator('.dash-size[data-size="l"]').click();
    await expect(widget).toHaveAttribute('data-size', 'l');

    // Wait for the save POST to land, then wipe the local mirror so the reload
    // can only come from the dashboard_layouts row (the cross-device case).
    const saved = page.waitForResponse((r) => r.url().includes('/api/dashboard/layout') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Lagre' }).click();
    await saved;
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('.dash-widget[data-widget="snarveier"]')).toHaveAttribute('data-size', 'l');
  });

  test('Rediger: remove a panel and add an optional one from the palette', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile');

    // "Om meg" is an optional panel — hidden by default, offered in the palette.
    const about = page.locator('.dash-widget[data-widget="about"]');
    await expect(about).toHaveClass(/dash-removed/);

    await page.getByRole('button', { name: 'Rediger' }).click();

    // Add it from the palette; it becomes visible.
    await page.locator('.dash-add[data-add="about"]').click();
    await expect(about).not.toHaveClass(/dash-removed/);

    // Remove a default panel; it drops into the palette.
    const stores = page.locator('.dash-widget[data-widget="stores"]');
    await stores.locator('.dash-remove').click();
    await expect(stores).toHaveClass(/dash-removed/);
    await expect(page.locator('.dash-add[data-add="stores"]')).toBeVisible();

    const saved = page.waitForResponse((r) => r.url().includes('/api/dashboard/layout') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Lagre' }).click();
    await saved;
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // Persisted: "Om meg" now shown, "Mine butikker" now hidden.
    await expect(page.locator('.dash-widget[data-widget="about"]')).not.toHaveClass(/dash-removed/);
    await expect(page.locator('.dash-widget[data-widget="stores"]')).toHaveClass(/dash-removed/);
  });

  test('locked panels (stats, admin) resize but cannot be removed', async ({ page }) => {
    await loginAs(page, 'silje@test.strikketorget.no'); // admin persona
    await page.goto('/profile');
    const admin = page.locator('.dash-widget[data-widget="admin"]');
    const stats = page.locator('.dash-widget[data-widget="stats"]');
    await expect(admin).toBeVisible();
    await expect(stats).toBeVisible();

    await page.getByRole('button', { name: 'Rediger' }).click();
    // Both have a size control...
    await expect(admin.locator('.dash-sizes')).toBeVisible();
    await expect(stats.locator('.dash-sizes')).toBeVisible();
    // ...but no remove button, and are never offered in the palette.
    await expect(admin.locator('.dash-remove')).toHaveCount(0);
    await expect(stats.locator('.dash-remove')).toHaveCount(0);
    await expect(page.locator('.dash-add[data-add="admin"]')).toHaveCount(0);
    await expect(page.locator('.dash-add[data-add="stats"]')).toHaveCount(0);

    // Resizing admin to S hides tile subtext.
    await admin.locator('.dash-size[data-size="s"]').click();
    await expect(admin).toHaveAttribute('data-size', 's');
    await expect(admin.locator('.dash-sub').first()).toBeHidden();
  });

  test('Rediger: grid ↔ staggered mode persists', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile');
    const grid = page.locator('#dashgrid');
    await expect(grid).not.toHaveClass(/dash-masonry/);

    await page.getByRole('button', { name: 'Rediger' }).click();
    await page.locator('[data-set-mode="masonry"]').click(); // Rutenett | Stablet segmented control
    await expect(grid).toHaveClass(/dash-masonry/);
    await expect(page.locator('[data-set-mode="masonry"]')).toHaveClass(/is-active/);

    const saved = page.waitForResponse((r) => r.url().includes('/api/dashboard/layout') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Lagre' }).click();
    await saved;
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    // Mode came back from the server row (localStorage was wiped).
    await expect(page.locator('#dashgrid')).toHaveClass(/dash-masonry/);
  });
});
