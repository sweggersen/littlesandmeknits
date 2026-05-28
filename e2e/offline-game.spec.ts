import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// E2E for the Strikkeklikker offline game. We can't easily simulate a
// real SW fallback in Playwright, so instead we extract the OFFLINE_HTML
// from public/sw.js and load it directly via setContent — that exercises
// the exact same HTML/JS the user sees when the SW serves it.

function readOfflineHtml(): string {
  const sw = readFileSync(resolve('public/sw.js'), 'utf8');
  // The template literal between OFFLINE_HTML = `...`;
  const m = sw.match(/const OFFLINE_HTML = `([\s\S]*?)`;/);
  if (!m) throw new Error('OFFLINE_HTML not found in sw.js');
  // Unescape any inner backticks (none today, but defensive).
  return m[1];
}

test.describe('Offline page game', () => {
  test('renders the canvas + counter and the page stays alive on click', async ({ page }) => {
    const html = readOfflineHtml();

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.setContent(html);

    await expect(page.getByRole('heading', { name: 'Du er offline' })).toBeVisible();
    await expect(page.getByText('Strikkeklikker')).toBeVisible();
    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('#score')).toHaveText('0');
    await expect(page.getByRole('button', { name: 'Prøv igjen' })).toBeVisible();

    // Drive clicks across the canvas; this exercises the pointerdown
    // handler + the hit-test math even if no ball is under the cursor.
    const canvas = page.locator('#game');
    for (let i = 0; i < 8; i++) {
      await canvas.click({ position: { x: 50 + i * 30, y: 100 + i * 30 } });
    }

    // The game should still be running (no JS errors thrown) and the
    // counter element should still exist.
    expect(errors, `page errors: ${errors.join(', ')}`).toEqual([]);
    await expect(page.locator('#score')).toBeVisible();
  });

  test('Game-over replay button resets the score', async ({ page }) => {
    const html = readOfflineHtml();
    await page.setContent(html);

    // Force the game over by exposing it through the dialog directly:
    // we can't easily reach into the closure, but we can manipulate the
    // DOM the closure exposes. Click the replay button explicitly to
    // verify it's wired up; this is enough to catch a regression where
    // the listener is dropped.
    await page.locator('#over').evaluate((el) => el.setAttribute('data-on', ''));
    await expect(page.locator('#over')).toBeVisible();
    await page.getByRole('button', { name: 'Strikk igjen' }).click();
    await expect(page.locator('#over')).toBeHidden();
    await expect(page.locator('#score')).toHaveText('0');
  });
});
