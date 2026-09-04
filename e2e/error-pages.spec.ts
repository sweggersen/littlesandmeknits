import { test, expect } from '@playwright/test';

// The branded 404 replaces bare "Not found" plain-text responses. (500.astro
// can't be reliably forced from an e2e without a throwing route, so it's
// covered by build + the unit/type layer, not here.)
test.describe('Error pages', () => {
  test('an unknown route renders the branded 404 with a 404 status', async ({ page }) => {
    const res = await page.goto('/this-route-does-not-exist-xyz', { waitUntil: 'domcontentloaded' });
    expect(res, 'no response').not.toBeNull();
    expect(res!.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Vi fant ikke siden' })).toBeVisible();
    // The branded page links back into the app.
    await expect(page.getByRole('link', { name: 'Til forsiden' })).toBeVisible();
  });
});
