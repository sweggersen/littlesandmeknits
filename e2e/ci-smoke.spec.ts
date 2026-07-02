import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// CI critical-path smoke (staff review P1.1). The regression class this exists
// to catch: SSR pages that BUILD fine but 500 at request time — exactly the
// 2026-06/07 outage, where unit tests + `npm run build` were green while every
// Supabase-touching page returned 500. So the core assertion here is
// deliberately blunt: each real page must respond 200, anonymous AND authed.
//
// Runs against the CI-booted local Supabase via the dev harness (localhost, so
// devToolsBlocked allows it). Kept small + robust on purpose — this GATES
// deploy, so it must not be flaky.

const ELINE = 'eline@test.strikketorget.no';
const LIV = 'liv@test.strikketorget.no';

let adminToken: string;

async function exec(api: APIRequestContext, action: string, body: Record<string, unknown> = {}) {
  const res = await api.post('/api/dev/test-exec', {
    headers: { 'X-Admin-Token': adminToken, 'Content-Type': 'application/json' },
    data: { action, ...body },
  });
  const json = await res.json();
  expect(json.ok, `${action} failed: ${json.error}`).toBeTruthy();
  return json;
}

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  const res = await page.request.post('/api/dev/test-login', { data: { email } });
  expect(res.ok(), `login as ${email} failed: ${await res.text()}`).toBeTruthy();
}

/** goto + assert the SSR response was 200 (not a 500). Returns nothing; the
 *  status IS the assertion — this is what a build-passes-but-500s bug trips. */
async function expect200(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(res, `no response for ${path}`).not.toBeNull();
  expect(res!.status(), `${path} returned ${res!.status()}`).toBe(200);
}

test.describe('CI smoke — SSR pages render (anonymous + authed)', () => {
  let listingPath: string;

  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
    await exec(request, 'cleanup');
    // test-login auto-creates users; seed one active listing to exercise the
    // listing-detail page (the page the outage 500'd).
    await request.post('/api/dev/test-login', { data: { email: ELINE } });
    await request.post('/api/dev/test-login', { data: { email: LIV } });
    const seed = await exec(request, 'seed-buyflow-listing', { user_emails: [ELINE, LIV] });
    listingPath = `/market/listing/${seed.data.listingId}`;
  });

  test.afterAll(async ({ request }) => {
    await exec(request, 'cleanup');
  });

  test('anonymous: home, marketplace, listing detail all 200', async ({ page }) => {
    await expect200(page, '/');
    await expect200(page, '/market');
    await expect(page.getByText(/Strikketorget|Strikk|annonser|marked/i).first()).toBeVisible();
    await expect200(page, listingPath);
    await expect(page.getByText('E2E demo: Strikket genser str. 2 år')).toBeVisible();
    // A gated route must redirect anonymous users to login (not 500).
    await expect200(page, '/inbox');
    await expect(page).toHaveURL(/\/login/);
  });

  test('authed: gated pages render for a logged-in user', async ({ page }) => {
    await loginAs(page, LIV);
    await expect200(page, '/inbox');
    await expect(page).not.toHaveURL(/\/login/);
    await expect200(page, '/studio');
    await expect200(page, '/profile/badges');
  });
});
