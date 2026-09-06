#!/usr/bin/env node
/**
 * One command to populate EVERY part of the app with believable, relational
 * data and a category-relevant image on every visual entity.
 *
 * Two phases, in this required order:
 *   1. Seed ROWS — POST the `seed-full` action to a RUNNING dev server, which
 *      drives the real services (src/lib/dev/seed-full.ts). This runs `cleanup`
 *      first, wiping the storage bucket.
 *   2. Hydrate IMAGE BYTES — upload src/assets/img/*.jpg into projects/_samples/
 *      (kept out of the deployed Worker; must run AFTER step 1's cleanup).
 *
 * Prereq: a dev server on SEED_PORT (default 4331). In this worktree:
 *   npx astro dev --port 4331   (with a .dev.vars pointing at local Supabase)
 *
 * Usage (LOCAL ONLY — refuses a non-local Supabase URL):
 *   PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<local key> \
 *   SEED_PORT=4331 node scripts/seed-full.mjs
 */
import { spawn } from 'node:child_process';
import { uploadSamples } from './seed-sample-images.mjs';

const sbUrl = process.env.PUBLIC_SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const port = process.env.SEED_PORT ?? '4331';
const appOrigin = process.env.SEED_APP_ORIGIN ?? `http://localhost:${port}`;

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(sbUrl)) {
  console.error(`\n  REFUSING: PUBLIC_SUPABASE_URL is not local (got "${sbUrl}"). Local only.\n`);
  process.exit(1);
}
if (!key) { console.error('\n  Missing SUPABASE_SERVICE_ROLE_KEY.\n'); process.exit(1); }

async function main() {
  console.log(`\n  Comprehensive seed → app ${appOrigin}, supabase ${sbUrl}\n`);

  // ── Phase 1: seed rows via the running dev server.
  let token;
  try {
    const tokRes = await fetch(`${appOrigin}/api/dev/test-token`);
    if (!tokRes.ok) throw new Error(`token ${tokRes.status}`);
    token = (await tokRes.json()).token;
  } catch (e) {
    console.error(`\n  Could not reach the dev server at ${appOrigin}.`);
    console.error(`  Start it first:  npx astro dev --port ${port}\n  (${e.message})\n`);
    process.exit(1);
  }

  console.log('  Seeding rows (this drives dozens of real service calls, ~30-60s)…');
  const res = await fetch(`${appOrigin}/api/dev/test-exec`, {
    method: 'POST',
    headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'seed-full' }),
  });
  const body = await res.json();
  if (!body.ok) { console.error(`\n  seed-full failed: ${body.error}\n`); process.exit(1); }
  const seeded = body.data.seeded ?? {};
  console.log('  Rows seeded:');
  for (const [k, v] of Object.entries(seeded).sort()) console.log(`    ${k.padEnd(22)} ${v}`);

  // ── Phase 2: hydrate the image bytes (AFTER cleanup wiped storage). These
  //    cover NON-listing entities (avatars, store logos/banners, project/yarn/
  //    library covers) and are the offline fallback for listings.
  console.log('\n  Hydrating sample images into projects/_samples/ …');
  const { ok, total } = await uploadSamples({ url: sbUrl, key, log: (m) => console.warn('    ' + m) });
  console.log(`  Uploaded ${ok}/${total} sample images.`);

  // ── Phase 3: give every LISTING a distinct, category-matched real photo from
  //    Wikimedia Commons (deduped by content hash → no two listings share an
  //    image). Best-effort: needs network; set SEED_SKIP_PHOTOS=1 to skip (the
  //    rotated _samples heroes from phase 1 remain, still category-relevant).
  if (process.env.SEED_SKIP_PHOTOS === '1') {
    console.log('\n  Skipping Wikimedia listing photos (SEED_SKIP_PHOTOS=1).');
  } else {
    console.log('\n  Fetching distinct per-listing photos from Wikimedia (network, ~1 min)…');
    const code = await runPhotos(sbUrl, key);
    if (code === 0) console.log('  Per-listing photos done.');
    else console.warn(`  Wikimedia photos step exited ${code} (kept rotated _samples heroes). Re-run: npm run seed:photos`);
  }

  console.log('\n  Done. Log in as a persona (e.g. eline@test.strikketorget.no) and browse.\n');
}

function runPhotos(sbUrl, key) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', 'scripts/marketplace-real-photos.ts'], {
      stdio: 'inherit',
      env: { ...process.env, PUBLIC_SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: key },
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

main().catch((e) => { console.error('\nFailed:', e); process.exit(1); });
