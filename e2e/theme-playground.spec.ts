import { test, expect } from '@playwright/test';

// The /dev/theme playground is DB-free (mock props only), so this spec needs
// no seeding or auth — it just loads the page and drives the live theme
// switcher, asserting that swapping themes rewrites the design tokens on
// <html>. This is the guard that the themeable-foundation stays wired up.

test.describe('Theme playground', () => {
  test('loads and lists the themes', async ({ page }) => {
    await page.goto('/dev/theme');
    await expect(page.getByRole('heading', { name: 'Tema-lekeplass' })).toBeVisible();
    for (const label of ['Linen', 'Solnedgang', 'Kveld']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }
  });

  test('switching theme rewrites tokens live', async ({ page }) => {
    await page.goto('/dev/theme');

    const readSurface = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim(),
      );

    // Default (Linen) — pure white surface, identical to production.
    await page.getByRole('button', { name: 'Linen' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'linen');
    const linenSurface = await readSurface();
    expect(linenSurface.toLowerCase()).toBe('#ffffff');

    // Dark (Kveld) — surface flips dark, so the token value must change.
    await page.getByRole('button', { name: 'Kveld' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'kveld');
    const kveldSurface = await readSurface();
    expect(kveldSurface.toLowerCase()).not.toBe('#ffffff');
    expect(kveldSurface.length).toBeGreaterThan(0);

    // Warm (Solnedgang) — distinct again.
    await page.getByRole('button', { name: 'Solnedgang' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'solnedgang');
  });
});
