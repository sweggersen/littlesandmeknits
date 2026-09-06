import { test, expect, type Page } from '@playwright/test';

// The user-facing theme switcher in the account dropdown (ThemePicker): clicking
// a swatch re-skins the site (data-theme on <html>), persists to localStorage,
// and survives a full navigation via the inline apply-before-paint script.

const ELINE = 'eline@test.strikketorget.no';

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  const res = await page.request.post('/api/dev/test-login', { data: { email } });
  expect(res.ok()).toBeTruthy();
}

test.describe('Account menu — theme picker', () => {
  test('switches theme, persists it, and survives navigation', async ({ page }) => {
    await loginAs(page, ELINE);
    await page.goto('/market');

    await page.click('[data-profile-menu-trigger]');
    await expect(page.locator('[data-theme-picker]')).toBeVisible();

    // Pick a distinctly different theme.
    await page.click('[data-theme-set="hav"]');

    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('hav');
    expect(await page.evaluate(() => localStorage.getItem('lm-theme'))).toBe('hav');

    // A full page load re-applies the saved theme before paint (no flash, no reset).
    await page.goto('/market/used');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('hav');
  });
});
