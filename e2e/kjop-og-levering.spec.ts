import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// E2E mirror of the test-tower "Kjøp & levering" scenario.
// State mutations go through /api/dev/test-exec (bypasses Stripe);
// the UI is driven for navigation + visual assertions at each state.

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
  const res = await page.request.post('/api/dev/test-login', { data: { email } });
  expect(res.ok(), `login as ${email} failed: ${await res.text()}`).toBeTruthy();
  // Verify the session actually persisted in the browser context
  const me = await page.request.get('/api/me');
  const meBody = await me.json();
  expect(meBody.user?.email, `session for ${email} did not stick`).toBe(email);
}

test.describe('Strikketorget — kjøp og levering', () => {
  test.beforeAll(async ({ request }) => {
    const r = await request.get('/api/dev/test-token');
    expect(r.ok()).toBeTruthy();
    adminToken = (await r.json()).token;
    await exec(request, 'cleanup');
  });

  test.afterAll(async ({ request }) => {
    await exec(request, 'cleanup');
  });

  test('full flow: list → buy → ship → confirm → review', async ({ page, request }) => {
    // ── Step 1: Eline is a Stripe-verified seller
    await exec(request, 'set-stripe-onboarded', { actor: ELINE });

    // ── Step 2: Eline creates a listing
    const create = await exec(request, 'create-listing', {
      actor: ELINE,
      params: {
        title: 'Strikket genser str 2 år',
        kind: 'pre_loved',
        category: 'genser',
        size_label: '2 år',
        price_nok: 349,
        condition: 'lite_brukt',
        description: 'Vakker strikket genser i merinoull. Brukt én sesong.',
      },
    });
    const listingId = create.data.id as string;

    // ── Step 3: Publish
    await exec(request, 'publish-listing', { params: { listing_id: listingId } });

    // Verify active listing page (logged out is fine — it's public)
    await loginAs(page, LIV);
    await page.goto(`/marked/listing/${listingId}`);
    await expect(page.getByRole('heading', { name: 'Strikket genser str 2 år' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Kjøp nå/ })).toBeVisible();

    // ── Step 4: Liv purchases (bypassing Stripe)
    await exec(request, 'purchase-listing', {
      actor: LIV,
      params: {
        listing_id: listingId,
        buyer_name: 'Liv Johansen',
        buyer_address: 'Storgata 12',
        buyer_postal_code: '0155',
        buyer_city: 'Oslo',
      },
    });

    // Liv should now see the "waiting for shipping" panel
    await page.reload();
    await expect(page.getByRole('heading', { name: /Venter på sending/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Bekreft mottatt/ })).toBeVisible();

    // Eline now sees the buyer's shipping address
    await loginAs(page, ELINE);
    await page.goto(`/marked/listing/${listingId}`);
    await expect(page.getByText('Noen har kjøpt varen din!')).toBeVisible();
    await expect(page.getByText('Liv Johansen')).toBeVisible();
    await expect(page.getByText('Storgata 12')).toBeVisible();
    await expect(page.getByText(/0155\s+Oslo/)).toBeVisible();

    // ── Step 5: Eline marks as shipped with a tracking code
    await exec(request, 'ship-listing', {
      actor: ELINE,
      params: { listing_id: listingId, tracking_code: 'POSTEN-98765' },
    });

    // Seller view confirms shipped state
    await page.reload();
    await expect(page.getByText(/Varen er sendt/)).toBeVisible();
    await expect(page.getByText('POSTEN-98765')).toBeVisible();

    // Buyer sees the same tracking code on her side
    await loginAs(page, LIV);
    await page.goto(`/marked/listing/${listingId}`);
    await expect(page.getByRole('heading', { name: /Varen er sendt/ })).toBeVisible();
    await expect(page.getByText('POSTEN-98765')).toBeVisible();

    // ── Step 6: Liv confirms delivery
    await exec(request, 'confirm-listing-delivery', {
      actor: LIV,
      params: { listing_id: listingId },
    });

    await page.reload();
    await expect(page.getByText(/Levering bekreftet/)).toBeVisible();

    // Review form should now be visible
    await expect(page.getByRole('heading', { name: /Gi selger en vurdering/ })).toBeVisible();

    // ── Step 7: Liv submits a review
    await exec(request, 'submit-seller-review', {
      actor: LIV,
      params: {
        listing_id: listingId,
        rating: 5,
        comment: 'Fantastisk kvalitet, nydelig genser! Rask levering.',
      },
    });

    await page.reload();
    await expect(page.getByText('Din vurdering')).toBeVisible();
    // Review form should be gone (already reviewed)
    await expect(page.getByRole('heading', { name: /Gi selger en vurdering/ })).not.toBeVisible();
  });
});
