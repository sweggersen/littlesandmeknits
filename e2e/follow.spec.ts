import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E: seller follow toggle from the seller profile page.
// State mutations go through /api/dev/test-exec; UI is exercised for the
// follow button click + redirect-back behaviour.

const ELINE = 'eline@test.strikketorget.no'; // seller
const LIV = 'liv@test.strikketorget.no';     // follower

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
  expect(res.ok(), `login as ${email} failed: ${await res.text()}`).toBeTruthy();
  const me = await page.request.get('/api/me');
  expect((await me.json()).user?.email, `session for ${email} did not stick`).toBe(email);
}

async function lookupId(api: APIRequestContext, email: string): Promise<string> {
  const { data } = await exec(api, 'lookup-user', { params: { email } });
  return data.id;
}

test.describe('Strikketorget — seller follow', () => {
  let elineId: string;

  test.beforeAll(async ({ request }) => {
    const r = await request.get('/api/dev/test-token');
    expect(r.ok()).toBeTruthy();
    adminToken = (await r.json()).token;
    await exec(request, 'cleanup');
    // set-profile-visible auto-creates the test user via ensureTestUser
    // before the lookup runs.
    await exec(request, 'set-profile-visible', { actor: ELINE });
    await exec(request, 'set-profile-visible', { actor: LIV });
    elineId = await lookupId(request, ELINE);
  });

  test.afterAll(async ({ request }) => {
    await exec(request, 'cleanup');
  });

  test('Liv follows then unfollows Eline from the seller profile page', async ({ page }) => {
    await loginAs(page, LIV);
    await page.goto(`/market/seller/${elineId}`);

    // Initial state: "+ Følg"
    const followBtn = page.getByRole('button', { name: '+ Følg' });
    await expect(followBtn).toBeVisible();

    await followBtn.click();
    await page.waitForURL(`**/market/seller/${elineId}`);

    // After click the button label flips
    await expect(page.getByRole('button', { name: '✓ Følger' })).toBeVisible();

    // Follower count appears in the meta strip
    await expect(page.getByText(/1 følger/)).toBeVisible();

    // Unfollow
    await page.getByRole('button', { name: '✓ Følger' }).click();
    await page.waitForURL(`**/market/seller/${elineId}`);
    await expect(page.getByRole('button', { name: '+ Følg' })).toBeVisible();
  });

  test('Eline does not see a follow button on her own profile', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto(`/market/seller/${elineId}`);
    await expect(page.getByRole('button', { name: /Følg/ })).toHaveCount(0);
  });
});
