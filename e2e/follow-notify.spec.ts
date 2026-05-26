import { test, expect, type APIRequestContext } from '@playwright/test';

// E2E: when a trusted seller publishes a listing, all their followers
// receive a 'seller_new_listing' notification.

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

test.describe('Strikketorget — follow notifications', () => {
  let elineId: string;

  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
    await exec(request, 'cleanup');
    await exec(request, 'set-profile-visible', { actor: ELINE });
    await exec(request, 'set-profile-visible', { actor: LIV });
    elineId = (await exec(request, 'lookup-user', { params: { email: ELINE } })).data.id;
    // Trusted seller: publish skips moderation and fires the notification immediately.
    await exec(request, 'set-trust', { actor: ELINE, params: { trust_score: 100, trust_tier: 'trusted' } });
    await exec(request, 'set-stripe-onboarded', { actor: ELINE });
  });

  test.afterAll(async ({ request }) => {
    await exec(request, 'cleanup');
  });

  test('Liv gets seller_new_listing notification after Eline publishes', async ({ request, page }) => {
    // Liv follows Eline via the UI to keep the test honest.
    await page.context().clearCookies();
    await page.request.post('/api/dev/test-login', { data: { email: LIV } });
    await page.goto(`/market/seller/${elineId}`);
    await page.getByRole('button', { name: '+ Følg' }).click();
    await expect(page.getByRole('button', { name: '✓ Følger' })).toBeVisible();

    // Sanity check: follow row actually persisted.
    const followCount = await exec(request, 'count-follows', { params: { seller_id: elineId } });
    expect(followCount.data.count, 'follow row missing').toBe(1);

    // Baseline: Liv has zero seller_new_listing notifications.
    const before = await exec(request, 'count-notifications', { actor: LIV, params: { type: 'seller_new_listing' } });
    expect(before.data.count).toBe(0);

    // Eline creates + publishes a listing (auto-approve via trusted tier).
    const created = await exec(request, 'create-listing', {
      actor: ELINE,
      params: {
        title: 'Babylue rosa str 0-3 mnd',
        kind: 'pre_loved',
        category: 'lue',
        size_label: '0-3 mnd',
        price_nok: 120,
        condition: 'som_ny',
        description: 'Mykt merinogarn, lite brukt.',
      },
    });
    const listingId = created.data.id;
    expect(listingId).toBeTruthy();

    await exec(request, 'publish-listing', { actor: ELINE, params: { listing_id: listingId } });

    // Liv should now have exactly one new-listing notification.
    const after = await exec(request, 'count-notifications', { actor: LIV, params: { type: 'seller_new_listing' } });
    expect(after.data.count).toBe(1);
  });
});
