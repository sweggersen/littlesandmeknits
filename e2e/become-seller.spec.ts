import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E: the new Stripe Connect Custom seller onboarding flow.
// Field validation is the main contract here — we don't actually create
// a Connect account against Stripe in tests (would need test-mode keys
// + live network). Submit and assert the redirect target instead.

const SELLER = 'sam-seller@test.strikketorget.no';

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
}

test.describe('Strikketorget — become-seller form', () => {
  test.beforeAll(async ({ request }) => {
    const r = await request.get('/api/dev/test-token');
    adminToken = (await r.json()).token;
    // test-login auto-creates the user if it doesn't exist
    await request.post('/api/dev/test-login', { data: { email: SELLER } });
  });

  test('renders the form with the right fields and copy', async ({ page }) => {
    await loginAs(page, SELLER);
    await page.goto('/profile/become-seller');
    await expect(page.getByRole('heading', { name: 'Få betalt for salgene dine' })).toBeVisible();
    await expect(page.getByLabel('Fullt navn')).toBeVisible();
    await expect(page.getByLabel('Fødselsdato')).toBeVisible();
    await expect(page.getByLabel('Kontonummer')).toBeVisible();
    await expect(page.getByLabel('Adresse')).toBeVisible();
    await expect(page.getByLabel('Postnr')).toBeVisible();
    await expect(page.getByLabel('Sted')).toBeVisible();
    await expect(page.getByText('Maks salgspris er 5 000 kr')).toBeVisible();
  });

  test('rejects invalid kontonummer with a clear error', async ({ page }) => {
    await loginAs(page, SELLER);
    await page.goto('/profile/become-seller');
    await page.getByLabel('Fullt navn').fill('Sam Mathias Weggersen');
    await page.getByLabel('Fødselsdato').fill('1985-07-13');
    // Wrong check digit — 12345678901 fails MOD-11
    await page.getByLabel('Kontonummer').fill('1234 56 78901');
    await page.getByLabel('Adresse').fill('Storgata 1');
    await page.getByLabel('Postnr').fill('0123');
    await page.getByLabel('Sted').fill('Oslo');
    await page.locator('input[name="terms"]').check();
    await page.getByRole('button', { name: 'Bli selger' }).click();
    await page.waitForURL('**/profile/become-seller?error=bad_kontonummer');
    await expect(page.getByText('Kontonummeret ser ikke ut til å være gyldig')).toBeVisible();
  });

  test('rejects single-word name', async ({ page }) => {
    await loginAs(page, SELLER);
    await page.goto('/profile/become-seller');
    await page.getByLabel('Fullt navn').fill('Sam');
    await page.getByLabel('Fødselsdato').fill('1985-07-13');
    await page.getByLabel('Kontonummer').fill('1234 56 78903'); // valid
    await page.getByLabel('Adresse').fill('Storgata 1');
    await page.getByLabel('Postnr').fill('0123');
    await page.getByLabel('Sted').fill('Oslo');
    await page.locator('input[name="terms"]').check();
    await page.getByRole('button', { name: 'Bli selger' }).click();
    await page.waitForURL('**/profile/become-seller?error=bad_name');
  });

  test('blocks submit without accepting terms (HTML required)', async ({ page }) => {
    await loginAs(page, SELLER);
    await page.goto('/profile/become-seller');
    await page.getByLabel('Fullt navn').fill('Sam Mathias Weggersen');
    await page.getByLabel('Fødselsdato').fill('1985-07-13');
    await page.getByLabel('Kontonummer').fill('1234 56 78903');
    await page.getByLabel('Adresse').fill('Storgata 1');
    await page.getByLabel('Postnr').fill('0123');
    await page.getByLabel('Sted').fill('Oslo');
    // Skip the terms checkbox
    await page.getByRole('button', { name: 'Bli selger' }).click();
    // Browser-native required validation prevents submit; URL stays put.
    await expect(page).toHaveURL(/\/profile\/become-seller$/);
  });
});
