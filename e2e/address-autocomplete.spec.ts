import { test, expect, type Page } from '@playwright/test';

// E2E: the single-field store address autocomplete. Kartverket is mocked (no
// live network) so we assert the interaction: typing → suggestions → pick fills
// the hidden precise_address / postnummer / location_city inputs the store
// service reads.

const USER = 'address-ac@test.strikketorget.no';

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  const res = await page.request.post('/api/dev/test-login', { data: { email } });
  expect(res.ok(), `login as ${email} failed: ${await res.text()}`).toBeTruthy();
}

test.describe('Store address autocomplete', () => {
  test.beforeAll(async ({ request }) => {
    await request.post('/api/dev/test-login', { data: { email: USER } });
  });

  test('picking a suggestion fills the hidden address fields', async ({ page }) => {
    // Mock Kartverket via our proxy endpoint.
    await page.route('**/api/geo/address-search*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          { text: 'Testveien 1', postnummer: '0150', poststed: 'Oslo' },
          { text: 'Testveien 2', postnummer: '0151', poststed: 'Oslo' },
        ]),
      }),
    );

    await loginAs(page, USER);
    await page.goto('/profile/stores/new');

    // Reveal the shared details step by choosing a store type.
    await page.locator('input[name="store_type"][value="personal"]').check({ force: true });

    const input = page.locator('[data-address-input]');
    await expect(input).toBeVisible();
    await input.fill('Testveien');

    // Suggestions render from the mocked response.
    const firstSuggestion = page.locator('[data-address-suggestions] li').first();
    await expect(firstSuggestion).toBeVisible();
    await expect(firstSuggestion).toContainText('Testveien 1, 0150 Oslo');

    await firstSuggestion.click();

    // The hidden inputs the service reads are now filled.
    await expect(page.locator('[data-address-precise]')).toHaveValue('Testveien 1');
    await expect(page.locator('[data-address-postnummer]')).toHaveValue('0150');
    await expect(page.locator('[data-address-city]')).toHaveValue('Oslo');
    // The visible field shows the full address.
    await expect(input).toHaveValue('Testveien 1, 0150 Oslo');
  });

  test('editing after a pick clears the hidden fields (no stale postnummer)', async ({ page }) => {
    await page.route('**/api/geo/address-search*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([{ text: 'Testveien 1', postnummer: '0150', poststed: 'Oslo' }]),
      }),
    );

    await loginAs(page, USER);
    await page.goto('/profile/stores/new');
    await page.locator('input[name="store_type"][value="personal"]').check({ force: true });

    const input = page.locator('[data-address-input]');
    await input.fill('Testveien');
    await page.locator('[data-address-suggestions] li').first().click();
    await expect(page.locator('[data-address-postnummer]')).toHaveValue('0150');

    // Typing again invalidates the pick.
    await input.pressSequentially('x');
    await expect(page.locator('[data-address-postnummer]')).toHaveValue('');
    await expect(page.locator('[data-address-precise]')).toHaveValue('');
  });
});
