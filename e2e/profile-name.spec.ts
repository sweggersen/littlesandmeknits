import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E: filling first_name + last_name on /profile/edit auto-derives the
// public display_name (when display_name field is left blank).

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

test.describe('Profile name fields', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
    await exec(request, 'cleanup');
    await exec(request, 'set-profile-visible', { actor: ELINE });
  });

  test.afterAll(async ({ request }) => {
    await exec(request, 'cleanup');
  });

  test('Fornavn + Etternavn save and compose display_name when blank', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile/edit');
    await expect(page.getByRole('heading', { name: 'Rediger profil' })).toBeVisible();

    await page.locator('input[name="first_name"]').fill('Eline');
    await page.locator('input[name="last_name"]').fill('Berge');
    // Leave display_name blank — should auto-derive
    await page.locator('input[name="display_name"]').fill('');

    await page.getByRole('button', { name: /Lagre/ }).click();
    await page.waitForURL(/\/profile\/edit\?saved=1/);
    await expect(page.getByText(/Profilen er oppdatert/)).toBeVisible();

    // Reload to verify persistence + auto-compose
    await page.goto('/profile/edit');
    await expect(page.locator('input[name="first_name"]')).toHaveValue('Eline');
    await expect(page.locator('input[name="last_name"]')).toHaveValue('Berge');
    await expect(page.locator('input[name="display_name"]')).toHaveValue('Eline Berge');
  });
});
