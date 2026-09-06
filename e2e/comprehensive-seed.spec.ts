import { test, expect } from '@playwright/test';
import { uploadSamples } from '../scripts/seed-sample-images.mjs';

// The comprehensive seeder (src/lib/dev/seed-full.ts) layers full category
// coverage, studio dashboards, favorites, a second store with members/invites,
// notifications of every type and dead-letter events on top of seed-world — with
// a category-relevant image on every visual entity. This spec runs it, then
// (best-effort) hydrates the sample images and asserts they RESOLVE (HTTP 200 on
// the storage render endpoint) across the key marketplace pages.

const SB_URL = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const canHydrate = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(SB_URL) && !!SB_KEY;

test('seed-full populates every area with category-relevant, resolving images', async ({ request, page }) => {
  test.setTimeout(240_000); // seed-world + all the extra layers = many real service calls

  // ── Seed the rows.
  const token = (await (await request.get('/api/dev/test-token')).json()).token;
  const res = await request.post('/api/dev/test-exec', {
    headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
    data: { action: 'seed-full' },
  });
  const body = await res.json();
  expect(body.ok, `seed-full failed: ${body.error}`).toBe(true);
  const s = body.data.seeded as Record<string, number>;

  // Base world (seed-world counts flow through) …
  expect(s.listings).toBeGreaterThanOrEqual(14);
  expect(s.stores).toBeGreaterThanOrEqual(1);
  // … plus every extra layer.
  expect(s.catalogue_listings, 'full category coverage').toBeGreaterThanOrEqual(18);
  expect(s.promoted).toBeGreaterThanOrEqual(1);
  expect(s.studios).toBeGreaterThanOrEqual(3);
  expect(s.needles).toBeGreaterThanOrEqual(4);
  expect(s.favorites).toBeGreaterThanOrEqual(4);
  expect(s.read_conversations).toBeGreaterThanOrEqual(1);
  expect(s.store_members).toBeGreaterThanOrEqual(2);
  expect(s.store_invites).toBeGreaterThanOrEqual(1);
  expect(s.store_listings).toBeGreaterThanOrEqual(3);
  expect(s.notif_types).toBeGreaterThanOrEqual(10);
  expect(s.dead_letters).toBeGreaterThanOrEqual(2);
  expect(s.profiles_enriched).toBeGreaterThanOrEqual(9);

  // ── Hydrate the image bytes (mirrors `npm run seed:samples`). Best-effort:
  //    skipped when the local Supabase service key isn't in the env (e.g. CI
  //    that only writes .dev.vars). The row assertions above still stand.
  if (canHydrate) {
    const { ok, total } = await uploadSamples({ url: SB_URL, key: SB_KEY });
    expect(ok, 'uploaded sample images').toBe(total);
  } else {
    test.info().annotations.push({ type: 'note', description: 'sample-image hydration skipped (no local SB service key in env)' });
  }

  // ── Key pages load and show category-relevant images that resolve.
  const RENDER = '/storage/v1/render/image/public/projects/';
  for (const path of ['/market/used', '/market/new', '/market/commissions', '/market/stores']) {
    const resp = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(resp?.ok(), `${path} did not load`).toBe(true);
  }

  // On the used-listings grid, at least one card must render an image through the
  // transform endpoint — and (when hydrated) that URL must return HTTP 200.
  await page.goto('/market/used', { waitUntil: 'domcontentloaded' });
  const renderImg = page.locator(`img[src*="${RENDER}"]`).first();
  await expect(renderImg, 'a listing card renders a transformed image').toBeVisible();
  const src = await renderImg.getAttribute('src');
  expect(src).toContain(RENDER);

  if (canHydrate && src) {
    const imgRes = await request.get(src);
    expect(imgRes.status(), `render URL should resolve: ${src}`).toBe(200);
    const type = imgRes.headers()['content-type'] ?? '';
    expect(type).toContain('image');
  }
});
