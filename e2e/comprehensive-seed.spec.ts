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

  // ── The grid must read like a real marketplace: no two visible cards share
  //    the same (title + image), and same-category cards don't all show the
  //    identical photo. Regression guard for the owner-flagged duplicate cards.
  //    This validates the OFFLINE _samples fallback (10 shared images, rotated).
  //    Full per-listing uniqueness comes from `npm run seed:photos` (Wikimedia),
  //    exercised by the opt-in strict block below.
  const readCards = () => page.$$eval('[data-listing-item]', (els) =>
    els.slice(0, 24).map((el) => ({
      title: el.querySelector('[data-card-body] p.font-medium')?.textContent?.trim() ?? '',
      src: el.querySelector('[data-card-img-wrap] img')?.getAttribute('src') ?? '',
    })),
  );
  const cards = await readCards();
  expect(cards.length, 'grid has cards').toBeGreaterThanOrEqual(8);

  // No exact duplicate cards (same title AND same image) — the "3 identical
  // lue cards" / "2 identical grey cards" the owner saw. Must be exactly zero.
  const cardKeys = cards.map((c) => `${c.title}||${c.src}`);
  expect(new Set(cardKeys).size, `duplicate cards: ${JSON.stringify(cards)}`).toBe(cards.length);

  // No listing title repeats across the whole catalogue (data-level de-dup).
  const allTitles = await page.$$eval('[data-listing-item] [data-card-body] p.font-medium',
    (els) => els.map((e) => e.textContent?.trim() ?? ''));
  const titleFreq = new Map<string, number>();
  for (const t of allTitles) titleFreq.set(t, (titleFreq.get(t) ?? 0) + 1);
  expect([...titleFreq.entries()].filter(([, n]) => n > 1),
    'a listing title repeats').toHaveLength(0);

  // Same-category listings vary: several distinct images, and no single image
  // dominates (the "one image per category" regression). With the 10-image
  // offline pool a couple of cross-category repeats can remain; the strict
  // no-repeat guarantee is the Wikimedia block below.
  const srcs = cards.map((c) => c.src).filter(Boolean);
  const imgFreq = new Map<string, number>();
  for (const sInner of srcs) imgFreq.set(sInner, (imgFreq.get(sInner) ?? 0) + 1);
  expect(new Set(srcs).size, 'grid shows several distinct images').toBeGreaterThanOrEqual(7);
  expect(Math.max(...imgFreq.values()), 'no image dominates the grid').toBeLessThanOrEqual(4);

  // ── Opt-in strict check: SEED_E2E_PHOTOS=1 runs the Wikimedia per-listing
  //    photo step (what `npm run seed:full` does) and asserts EVERY listing gets
  //    a distinct photo with zero adjacent repeats. Off by default so CI stays
  //    network-independent.
  if (process.env.SEED_E2E_PHOTOS === '1' && canHydrate) {
    const { spawn } = await import('node:child_process');
    const code: number = await new Promise((resolve) => {
      const child = spawn('npx', ['tsx', 'scripts/marketplace-real-photos.ts'], {
        stdio: 'inherit',
        env: { ...process.env, PUBLIC_SUPABASE_URL: SB_URL, SUPABASE_SERVICE_ROLE_KEY: SB_KEY },
      });
      child.on('close', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });
    expect(code, 'Wikimedia photo step').toBe(0);
    await page.goto('/market/used', { waitUntil: 'domcontentloaded' });
    const wCards = await readCards();
    const wSrcs = wCards.map((c) => c.src).filter(Boolean);
    expect(new Set(wSrcs).size, 'every listing has a distinct photo').toBe(wSrcs.length);
    for (let i = 1; i < wCards.length; i++) {
      expect(wCards[i].src, `adjacent Wikimedia photos repeat at ${i}`).not.toBe(wCards[i - 1].src);
    }
  }
});
