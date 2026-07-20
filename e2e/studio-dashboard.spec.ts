import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// The Strikkestua landing (/studio) now runs on the same editable-dashboard
// engine as /profile, persisting under the separate 'studio' context.

const ELINE = 'eline@test.strikketorget.no';
let adminToken: string;

async function exec(api: APIRequestContext, action: string, body: Record<string, unknown> = {}) {
  const res = await api.post('/api/dev/test-exec', {
    headers: { 'X-Admin-Token': adminToken, 'Content-Type': 'application/json' },
    data: { action, ...body },
  });
  expect(res.ok(), `${action} -> ${res.status()}`).toBeTruthy();
  return res.json();
}

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.request.post('/api/dev/test-login', { data: { email } });
}

test.describe('Studio dashboard', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
    await exec(request, 'cleanup'); // fresh: no saved studio layout
  });
  test.afterAll(async ({ request }) => { await exec(request, 'cleanup'); });

  test('renders the studio panels', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/studio');
    await expect(page.getByRole('heading', { name: 'Nøkkeltall' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Merker' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Snarveier' })).toBeVisible();
  });

  test('Rediger: resize persists under the studio context', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/studio');
    await page.getByRole('button', { name: 'Rediger' }).click();
    await expect(page.getByRole('button', { name: 'Lagre' })).toBeVisible();

    const learn = page.locator('.dash-widget[data-widget="learn"]');
    await expect(learn).toHaveAttribute('data-size', 'm');
    await learn.locator('.dash-size[data-size="l"]').click();
    await expect(learn).toHaveAttribute('data-size', 'l');

    const saved = page.waitForResponse((r) => r.url().includes('/api/dashboard/layout') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Lagre' }).click();
    await saved;
    await page.evaluate(() => localStorage.clear()); // prove it came from the DB
    await page.reload();
    await expect(page.locator('.dash-widget[data-widget="learn"]')).toHaveAttribute('data-size', 'l');
  });

  test('Nøkkeltall is locked (resize yes, remove no)', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/studio');
    await page.getByRole('button', { name: 'Rediger' }).click();
    const stats = page.locator('.dash-widget[data-widget="stats"]');
    await expect(stats.locator('.dash-sizes')).toBeVisible();
    await expect(stats.locator('.dash-remove')).toHaveCount(0);
    await expect(page.locator('.dash-add[data-add="stats"]')).toHaveCount(0);
  });
});
