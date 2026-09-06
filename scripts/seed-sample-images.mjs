#!/usr/bin/env node
/**
 * Hydrate projects/_samples/ with the real knit photos (src/assets/img) that the
 * dev seed references (SAMPLE_IMAGES in test-exec.ts; project/yarn/library covers
 * in seed-profile.ts) so listings, projects, the stash and the library show
 * category-relevant images instead of broken thumbnails.
 *
 * Run AFTER seeding (seed-world / seed-profile) and after any `cleanup`, which
 * wipes the storage bucket. Kept as a standalone Node script (not imported by the
 * app) so the ~1MB of images never bloats the deployed Worker, and so it can use
 * node:fs (the dev endpoint's runtime can't).
 *
 * LOCAL ONLY — refuses any non-local Supabase URL.
 *
 *   PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<local key> node scripts/seed-sample-images.mjs
 */
import fs from 'node:fs';

const URL = process.env.PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) {
  console.error(`REFUSING: PUBLIC_SUPABASE_URL is not local (got "${URL}"). Local only.`);
  process.exit(1);
}
if (!KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }

const NAMES = [
  'sage-sweater', 'autumn-cable', 'terracotta-knit', 'brown-wool', 'mustard-knit',
  'cream-flatlay', 'colorful-tshirt', 'texture-close', 'hands-knitting', 'grey-yarn-balls',
];

let ok = 0;
for (const n of NAMES) {
  const p = `src/assets/img/${n}.jpg`;
  if (!fs.existsSync(p)) { console.warn(`skip (missing): ${p}`); continue; }
  const r = await fetch(`${URL}/storage/v1/object/projects/_samples/${n}.jpg`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'image/jpeg', 'x-upsert': 'true' },
    body: fs.readFileSync(p),
  });
  if (r.ok) ok++; else console.warn(`${n}: ${r.status} ${(await r.text()).slice(0, 80)}`);
}
console.log(`Uploaded ${ok}/${NAMES.length} sample images to projects/_samples/`);
