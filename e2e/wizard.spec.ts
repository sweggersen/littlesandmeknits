import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E for the listing wizard: details → price & shipping → redirect to
// /foto step → publish gated on having ≥1 photo.

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

test.describe('Strikketorget — listing wizard', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
    await exec(request, 'cleanup');
    // ensure persona + stripe so the wizard accepts the form
    await exec(request, 'set-profile-visible', { actor: ELINE });
    await exec(request, 'set-stripe-onboarded', { actor: ELINE });
  });

  test.afterAll(async ({ request }) => {
    await exec(request, 'cleanup');
  });

  test('wizard step 1 → 2 → submit lands on /foto', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/market/listing/new');

    // Step 1: details
    await page.locator('#kind').selectOption('pre_loved');
    // Ensure the wizard's syncKind() ran so the condition field is enabled+named.
    await page.locator('#kind').dispatchEvent('change');
    await page.locator('#title').fill('Wizard-test annonse');
    await page.locator('#category').selectOption('genser');
    await page.locator('#size_label').fill('2 år');
    await page.locator('#condition').selectOption('lite_brukt');
    await page.getByRole('button', { name: /^Neste/ }).click();

    // Step 2: price & shipping
    await page.locator('#price_nok').fill('250'); // step="10" — must be a multiple of 10

    // Wait until the submit button becomes visible (step 2 active).
    const submitBtn = page.getByRole('button', { name: /Lagre & last opp bilder/ });
    await expect(submitBtn).toBeVisible();
    // Capture the response so we surface useful diagnostics on failure.
    const respPromise = page.waitForResponse((r) =>
      r.url().includes('/api/marketplace/listings/create')
    );
    await submitBtn.click();
    const resp = await respPromise;
    expect(resp.status(), `create POST returned ${resp.status()}: ${await resp.text().catch(() => '')}`).toBeLessThan(400);

    // Should land on /foto for the new draft.
    await page.waitForURL(/\/market\/listing\/[^/]+\/foto$/);
    await expect(page.getByRole('heading', { name: 'Last opp bilder' })).toBeVisible();
    // Mini-summary repeats what we just submitted.
    await expect(page.getByText('Wizard-test annonse')).toBeVisible();
    // Publish CTA is hidden until at least one photo is uploaded.
    await expect(page.getByText(/Last opp minst ett bilde/)).toBeVisible();
  });

  test('"Fyll inn et eksempel" pre-fills step 1', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/market/listing/new');
    await page.getByRole('button', { name: /Fyll inn et eksempel/ }).click();
    await expect(page.locator('#title')).toHaveValue('Mariusgenser str. 92, naturhvit');
    await expect(page.locator('#category')).toHaveValue('genser');
    await expect(page.locator('#size_label')).toHaveValue('92');
    // Helper hides itself once used.
    await expect(page.getByRole('button', { name: /Fyll inn et eksempel/ })).toHaveCount(0);
  });
});
