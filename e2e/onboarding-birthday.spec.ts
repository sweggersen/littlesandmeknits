import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E: /onboarding/birthday persists the chosen DOB and skip works.

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

test.describe('Onboarding birthday', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
    await exec(request, 'cleanup');
    await exec(request, 'set-profile-visible', { actor: ELINE });
  });

  test.afterAll(async ({ request }) => {
    await exec(request, 'cleanup');
  });

  test('birthday selection persists and redirects to next', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/onboarding/birthday?next=/profile/edit');
    await expect(page.getByRole('heading', { name: /Når har du bursdag/ })).toBeVisible();

    await page.locator('select[name="day"]').selectOption('21');
    await page.locator('select[name="month"]').selectOption('8');
    await page.locator('select[name="year"]').selectOption('1989');
    await page.getByRole('button', { name: 'Lagre' }).click();

    await page.waitForURL(/\/profile\/edit$/);

    // Re-visit the onboarding page — should bounce away since birthday is set.
    await page.goto('/onboarding/birthday?next=/market');
    await page.waitForURL(/\/market$/);
  });

  test('Skip link goes to next without saving', async ({ page, request }) => {
    // Wipe Eline's birthday so the prompt shows again.
    await exec(request, 'cleanup');
    await exec(request, 'set-profile-visible', { actor: ELINE });
    await loginAs(page, ELINE);

    await page.goto('/onboarding/birthday?next=/market');
    await page.getByRole('link', { name: /Hopp over/ }).click();
    await page.waitForURL(/\/market$/);
  });
});
