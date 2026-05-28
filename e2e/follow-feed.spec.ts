import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E for the gap-#9 surface: the "Nye fra sellere du følger" home row
// and the dedicated /market/following feed page.

const ELINE = 'eline@test.strikketorget.no';
const LIV = 'liv@test.strikketorget.no';

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
  const r = await page.request.post('/api/dev/test-login', { data: { email } });
  expect(r.ok(), `login as ${email} failed: ${await r.text()}`).toBeTruthy();
  const me = await page.request.get('/api/me');
  expect((await me.json()).user?.email, `session for ${email} did not stick`).toBe(email);
}

test.describe('Strikketorget — follow feed surfaces', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
    await exec(request, 'cleanup');
    await exec(request, 'seed-screens', { params: { user_emails: [ELINE, LIV] } });
  });

  test.afterAll(async ({ request }) => {
    await exec(request, 'cleanup');
  });

  test('Home shows "Nye fra sellere du følger" when Liv follows Eline', async ({ page }) => {
    await loginAs(page, LIV);
    await page.goto('/market');
    await expect(page.getByRole('heading', { name: 'Nye fra sellere du følger' })).toBeVisible();
    // Eline's seeded active listing should be in the row (also appears in
    // recommendations below — first match is enough).
    await expect(page.getByText('Strikket genser str 2 år (publisert)').first()).toBeVisible();
  });

  test('/market/following lists active listings from followed sellers', async ({ page }) => {
    await loginAs(page, LIV);
    await page.goto('/market/following');
    await expect(page.getByRole('heading', { name: 'Sellere du følger' })).toBeVisible();
    await expect(page.getByText('Strikket genser str 2 år (publisert)')).toBeVisible();
  });

  test('/market/following empty state when not following anyone', async ({ page, request }) => {
    // Tear down follows for Liv (keep listings around) by re-cleaning then
    // re-creating just the Eline side and the active listing (no follow row).
    await exec(request, 'cleanup');
    await exec(request, 'set-profile-visible', { actor: ELINE });
    await exec(request, 'set-profile-visible', { actor: LIV });

    await loginAs(page, LIV);
    await page.goto('/market/following');
    await expect(page.getByText(/Du følger ingen sellere ennå/)).toBeVisible();
  });
});
