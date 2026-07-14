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
    // Stat cards (label also appears in the feed, so scope to first).
    await expect(page.getByText('Uleste meldinger').first()).toBeVisible();
    await expect(page.getByText('Kjøpte oppskrifter').first()).toBeVisible();
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
    await widget.locator('.dash-size').click(); // m → l
    await expect(widget).toHaveAttribute('data-size', 'l');

    await page.getByRole('button', { name: 'Lagre' }).click();
    await page.reload();
    await expect(page.locator('.dash-widget[data-widget="needsAttention"]')).toHaveAttribute('data-size', 'l');
  });

  test('Rediger: layout persists server-side (survives a localStorage wipe)', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Rediger' }).click();
    const widget = page.locator('.dash-widget[data-widget="snarveier"]');
    const before = await widget.getAttribute('data-size');
    await widget.locator('.dash-size').click(); // cycle size
    const after = await widget.getAttribute('data-size');
    expect(after).not.toBe(before);

    // Wait for the save POST to land, then wipe the local mirror so the reload
    // can only come from the dashboard_layouts row (the cross-device case).
    const saved = page.waitForResponse((r) => r.url().includes('/api/dashboard/layout') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Lagre' }).click();
    await saved;
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('.dash-widget[data-widget="snarveier"]')).toHaveAttribute('data-size', after!);
  });
});
