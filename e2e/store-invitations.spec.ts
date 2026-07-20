import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Store invitations: the owner can cancel a pending invite, and the invited
// user sees + accepts it in-app (there is no invite email yet).

const OWNER = 'eline@test.strikketorget.no';
const INVITEE = 'liv@test.strikketorget.no';
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

test.describe('Store invitations', () => {
  let slug = '';

  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
    await exec(request, 'cleanup');
    await request.post('/api/dev/test-login', { data: { email: OWNER } });
    await exec(request, 'seed-profile', { actor: OWNER }); // gives eline a store she owns
  });
  test.afterAll(async ({ request }) => { await exec(request, 'cleanup'); });

  test('owner can invite, sees + cancels a pending invitation; invitee sees + accepts it', async ({ page }) => {
    // Find the owner's store slug from her stores page.
    await loginAs(page, OWNER);
    await page.goto('/profile/stores');
    const href = await page.locator('a[href*="/market/store/"]').first().getAttribute('href');
    slug = /store\/([^/]+)\/admin/.exec(href ?? '')?.[1] ?? '';
    expect(slug).not.toBe('');

    // Invite the invitee.
    await page.request.post(`/api/stores/${slug}/members`, {
      headers: { 'Content-Type': 'application/json' },
      data: { action: 'invite', email: INVITEE, role: 'contributor' },
    });

    // Owner sees the pending invite with a cancel button.
    await page.goto(`/market/store/${slug}/admin/members`);
    await expect(page.getByText(INVITEE)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kanseller' })).toBeVisible();

    // Invitee sees it in-app and accepts.
    await loginAs(page, INVITEE);
    await page.goto('/profile/stores');
    await expect(page.getByText('Min Strikkebutikk')).toBeVisible();
    await page.getByRole('button', { name: 'Godta' }).click();
    // Accept lands on the store admin (now a member).
    await page.waitForURL(/\/market\/store\//);
  });
});
