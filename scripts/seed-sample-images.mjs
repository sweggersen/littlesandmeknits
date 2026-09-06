#!/usr/bin/env node
/**
 * Hydrate projects/_samples/ with the real knit photos (src/assets/img) that the
 * dev seed references (SAMPLE_IMAGES in src/lib/dev/sample-images.ts; project/
 * yarn/library/store/avatar covers in seed-profile.ts / seed-full.ts) so
 * listings, projects, the stash, the library, stores and avatars show
 * category-relevant images instead of broken thumbnails.
 *
 * Run AFTER seeding (seed-world / seed-full / seed-profile) and after any
 * `cleanup`, which wipes the storage bucket. Kept as a standalone Node script
 * (not imported by the app) so the ~1MB of images never bloats the deployed
 * Worker, and so it can use node:fs (the dev endpoint's runtime can't).
 *
 * LOCAL ONLY — refuses any non-local Supabase URL.
 *
 *   PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<local key> node scripts/seed-sample-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep in sync with SAMPLE_IMAGE_NAMES in src/lib/dev/sample-images.ts
// (guarded by src/lib/dev/sample-images.test.ts).
export const SAMPLE_NAMES = [
  'sage-sweater', 'autumn-cable', 'terracotta-knit', 'brown-wool', 'mustard-knit',
  'cream-flatlay', 'colorful-tshirt', 'texture-close', 'hands-knitting', 'grey-yarn-balls',
];

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Upload every sample JPEG into projects/_samples/. Returns {ok, total}.
 * @param {{ url: string, key: string, log?: (m: string) => void }} opts
 */
export async function uploadSamples({ url, key, log = () => {} }) {
  let ok = 0;
  for (const n of SAMPLE_NAMES) {
    const p = path.join(REPO_ROOT, 'src/assets/img', `${n}.jpg`);
    if (!fs.existsSync(p)) { log(`skip (missing): ${p}`); continue; }
    const r = await fetch(`${url}/storage/v1/object/projects/_samples/${n}.jpg`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'image/jpeg', 'x-upsert': 'true' },
      body: fs.readFileSync(p),
    });
    if (r.ok) ok++; else log(`${n}: ${r.status} ${(await r.text()).slice(0, 80)}`);
  }
  return { ok, total: SAMPLE_NAMES.length };
}

// Run directly (CLI) — guard on a local URL, then upload.
if (import.meta.url === `file://${process.argv[1]}`) {
  const sbUrl = process.env.PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(sbUrl)) {
    console.error(`REFUSING: PUBLIC_SUPABASE_URL is not local (got "${sbUrl}"). Local only.`);
    process.exit(1);
  }
  if (!key) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
  const { ok, total } = await uploadSamples({ url: sbUrl, key, log: (m) => console.warn(m) });
  console.log(`Uploaded ${ok}/${total} sample images to projects/_samples/`);
}
