import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E coverage of the stores feature: creation wizard, moderation, public
// storefront, invitations + role changes, listing-under-store, and the
// existing-seller conversion flow. Mutations go through the real API where
// possible — only Brønnøysund's external lookup and the moderation queue
// are short-circuited (via real orgnr + dev approval endpoint).

const ELINE = 'eline@test.strikketorget.no';   // store owner
const MAJA = 'maja@test.strikketorget.no';     // invited member
const LIV = 'liv@test.strikketorget.no';       // unrelated user

// Real, stable Norwegian orgnr — Stortinget (STAT type, active status).
const TEST_ORGNR = '971524960';

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

async function createStoreAs(page: Page, opts: { name: string; slug: string }) {
  const res = await page.request.post('/api/stores', {
    data: {
      orgnr: TEST_ORGNR,
      name: opts.name,
      slug: opts.slug,
      tagline: 'Håndlagde plagg fra teamet',
      description: 'Vi designer og strikker plagg for små.',
      contact_email: 'kunde@example.no',
    },
  });
  expect(res.ok(), `create store failed: ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function approveStore(page: Page, slug: string) {
  const res = await page.request.post('/api/dev/approve-store', {
    headers: { 'X-Admin-Token': adminToken, 'Content-Type': 'application/json' },
    data: { slug },
  });
  expect(res.ok(), `approve-store failed: ${await res.text()}`).toBeTruthy();
}

test.describe('Strikketorget — butikker', () => {
  test.beforeAll(async ({ request }) => {
    const r = await request.get('/api/dev/test-token');
    expect(r.ok()).toBeTruthy();
    adminToken = (await r.json()).token;
    await exec(request, 'cleanup');
  });

  test.afterAll(async ({ request }) => {
    await exec(request, 'cleanup');
  });

  test.afterEach(async ({ request }) => {
    // Reset DB between tests so each one starts from a clean slate.
    await exec(request, 'cleanup');
  });

  test('wizard: orgnr lookup, create store, moderation, approved storefront', async ({ page, request }) => {
    await loginAs(page, ELINE);

    // ── Visit the wizard
    await page.goto('/profile/stores/new');
    await expect(page.getByRole('heading', { name: 'Opprett butikk' })).toBeVisible();

    // ── Orgnr lookup
    await page.fill('#orgnr-input', TEST_ORGNR);
    await page.click('#lookup-btn');
    await expect(page.getByText('Registrert i Brønnøysund')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('STORTINGET', { exact: false })).toBeVisible();

    // The form auto-fills name + slug
    await expect(page.locator('#name-input')).not.toHaveValue('');
    await expect(page.locator('#slug-input')).not.toHaveValue('');

    // Override name + slug to predictable values + fill required email
    await page.fill('#name-input', 'Test-butikken');
    await page.fill('#slug-input', 'test-butikken');
    await page.fill('input[name="contact_email"]', 'kunde@test-butikken.no');
    await page.check('input[name="privacy_consent"]');

    // ── Submit creates store + sends to moderation; we land on /admin
    await Promise.all([
      page.waitForURL(/\/market\/store\/test-butikken\/admin$/, { timeout: 15_000 }),
      page.click('button[type="submit"]'),
    ]);

    await expect(page.getByRole('heading', { name: 'Oversikt' })).toBeVisible();
    await expect(page.getByText('Til moderering').first()).toBeVisible();

    // Public storefront should NOT be visible to anonymous viewers while
    // pending_review. (Members + moderators CAN preview — that's an
    // intentional moderator-tooling feature.)
    const anonCtx = await page.context().browser()!.newContext();
    const anonRes = await anonCtx.request.get('/market/store/test-butikken');
    expect(anonRes.status()).toBe(404);
    await anonCtx.close();

    // ── Approve via dev endpoint
    await approveStore(page, 'test-butikken');

    // Public storefront live
    await page.goto('/market/store/test-butikken');
    await expect(page.getByRole('heading', { name: 'Test-butikken' })).toBeVisible();
    await expect(page.getByText('STORTINGET', { exact: false })).toBeVisible(); // legal_name visible
  });

  test('invite a member, accept, role visible in admin', async ({ page, browser }) => {
    await loginAs(page, ELINE);
    const create = await createStoreAs(page, { name: 'Garn & gull', slug: 'garn-og-gull' });
    expect(create.storeId).toBeTruthy();
    await approveStore(page, 'garn-og-gull');

    // ── Invite Maja via the JSON API (mirrors what the form does)
    const inviteRes = await page.request.post('/api/stores/garn-og-gull/members', {
      headers: { 'Content-Type': 'application/json' },
      data: { action: 'invite', email: MAJA, role: 'manager' },
    });
    expect(inviteRes.ok(), `invite failed: ${await inviteRes.text()}`).toBeTruthy();
    const { token } = await inviteRes.json();
    expect(token).toMatch(/^[a-f0-9]{48}$/);

    // ── Open a fresh context as Maja and accept
    const majaCtx = await browser.newContext();
    const majaPage = await majaCtx.newPage();
    await loginAs(majaPage, MAJA);

    await majaPage.goto(`/invite/${token}`);
    await expect(majaPage.getByRole('heading', { name: /Bli med i/ })).toBeVisible();

    await Promise.all([
      majaPage.waitForURL(/\/market\/store\/garn-og-gull\/admin$/, { timeout: 10_000 }),
      majaPage.click('button[type="submit"]'),
    ]);

    // Maja now sees the admin dashboard
    await expect(majaPage.getByRole('heading', { name: 'Oversikt' })).toBeVisible();

    // ── Eline sees Maja in the members list
    await page.goto('/market/store/garn-og-gull/admin/members');
    // The members list section
    const membersList = page.getByText('Nåværende medlemmer').locator('..');
    await expect(membersList.getByText(MAJA.split('@')[0], { exact: false })).toBeVisible();
    await expect(membersList.getByText('Forvalter').first()).toBeVisible();

    await majaCtx.close();
  });

  test('listing creation has "Sell as" dropdown that includes the store', async ({ page }) => {
    await loginAs(page, ELINE);
    const created = await createStoreAs(page, { name: 'Strikkebua', slug: 'strikkebua' });
    await approveStore(page, 'strikkebua');

    await page.goto('/market/listing/new');
    await expect(page.locator('select[name="store_id"]')).toBeVisible();
    await expect(page.locator('select[name="store_id"] option')).toContainText(['Strikkebua']);

    // Pre-selection via ?store=<id>
    await page.goto(`/market/listing/new?store=${created.storeId}`);
    await expect(page.locator('select[name="store_id"]')).toHaveValue(created.storeId);
  });

  test('public stores browse page shows approved store', async ({ page }) => {
    await loginAs(page, ELINE);
    await createStoreAs(page, { name: 'Synlig Butikk', slug: 'synlig-butikk' });
    await approveStore(page, 'synlig-butikk');

    // Browse anonymously
    await page.context().clearCookies();
    await page.goto('/market/stores');
    await expect(page.getByRole('heading', { name: 'Butikker' })).toBeVisible();
    await expect(page.getByText('Synlig Butikk')).toBeVisible();
  });

  test('non-member cannot reach the admin pages', async ({ page, browser }) => {
    await loginAs(page, ELINE);
    await createStoreAs(page, { name: 'Privat Butikk', slug: 'privat-butikk' });
    await approveStore(page, 'privat-butikk');

    const livCtx = await browser.newContext();
    const livPage = await livCtx.newPage();
    await loginAs(livPage, LIV);

    const res = await livPage.goto('/market/store/privat-butikk/admin');
    // Should redirect to the public storefront (302 → /market/store/...)
    expect(livPage.url()).toMatch(/\/market\/store\/privat-butikk(?!\/admin)/);

    await livCtx.close();
  });

  test('orgnr lookup rejects invalid format', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/profile/stores/new');
    await page.fill('#orgnr-input', '12345');
    await page.click('#lookup-btn');
    await expect(page.getByText(/Organisasjonsnummer må være 9 sifre|Ugyldig/)).toBeVisible({ timeout: 5_000 });
  });

  test('store creation enqueues a moderation_queue item', async ({ page, request }) => {
    await loginAs(page, ELINE);
    const created = await createStoreAs(page, { name: 'Queue test', slug: 'queue-test' });

    // Inspect the queue via test-exec — there should be exactly one item of
    // type=store pointing at the new store id.
    const res = await request.post('/api/dev/test-exec', {
      headers: { 'X-Admin-Token': adminToken, 'Content-Type': 'application/json' },
      data: {
        action: 'get-state',
        params: { include_queue: true },
      },
    });
    expect(res.ok()).toBeTruthy();
    const { data } = await res.json();
    const storeQueueItems = (data.queue ?? []).filter(
      (q: any) => q.item_type === 'store' && q.item_id === created.storeId,
    );
    expect(storeQueueItems.length, 'expected exactly one moderation queue item for the new store').toBe(1);
    expect(storeQueueItems[0].status).toBe('pending');
  });

  test('duplicate orgnr is rejected', async ({ page }) => {
    await loginAs(page, ELINE);
    await createStoreAs(page, { name: 'Første', slug: 'forste' });

    // Try to create a second store with the same orgnr
    const res = await page.request.post('/api/stores', {
      data: { orgnr: TEST_ORGNR, name: 'Duplikat', slug: 'duplikat', contact_email: 'a@b.no' },
    });
    expect(res.status()).toBe(409);
  });

  test('cannot create a listing under a pending_review store', async ({ page }) => {
    await loginAs(page, ELINE);
    const created = await createStoreAs(page, { name: 'Pending Store', slug: 'pending-store' });
    // Store is in pending_review here — DON'T approve.

    const res = await page.request.post('/api/marketplace/listings/create', {
      form: {
        kind: 'pre_loved',
        title: 'Test',
        category: 'genser',
        size_label: '2 år',
        price_nok: '100',
        condition: 'lite_brukt',
        store_id: created.storeId,
      },
    });
    // Service returns 409 (conflict). The API returns the service result as
    // a Response — the body has the error message.
    expect(res.status()).toBe(409);
  });
});
