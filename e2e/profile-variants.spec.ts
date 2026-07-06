import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E smoke for the profile-page design variants (/profile/v2..v4). They render
// the SAME data as /profile via the shared loader; this asserts each loads for a
// logged-in user, shows a distinctive marker, and the switcher navigates.

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

test.describe('Profile design variants', () => {
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

  test('V2 Command Center loads with its markers', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile/v2');
    await expect(page.getByText('Kommandosenter')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trenger oppmerksomhet' })).toBeVisible();
  });

  test('V3 Editorial loads with its hero', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile/v3');
    // "Min profil" also appears in the nav; scope to the hero eyebrow in <main>.
    await expect(page.getByRole('main').getByText('Min profil', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Prosjekter' })).toBeVisible();
  });

  test('V4 Focus loads with its today card', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile/v4');
    await expect(page.getByText('I dag', { exact: true })).toBeVisible();
  });

  test('switcher exposes all four variants with correct links', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile');
    await expect(page.getByRole('link', { name: 'V2 · Kommando' })).toHaveAttribute('href', '/profile/v2');
    await expect(page.getByRole('link', { name: 'V3 · Redaksjonell' })).toHaveAttribute('href', '/profile/v3');
    await expect(page.getByRole('link', { name: 'V4 · Fokus' })).toHaveAttribute('href', '/profile/v4');
    // The current-variant chip is marked.
    await expect(page.getByRole('link', { name: 'Original' })).toHaveAttribute('aria-current', 'page');
  });
});
