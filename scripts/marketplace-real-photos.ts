#!/usr/bin/env npx tsx
/**
 * Replace seeded placeholder photos with REAL knitting/knitwear images.
 *
 * For every listing: clears existing listing_photos (+ storage files), then
 * fetches >=3 category-matched real images from LoremFlickr (Flickr CC photos
 * by keyword), uploads them to the `projects` storage bucket, inserts
 * listing_photos rows, and sets hero_photo_path. Images are deduped by content
 * hash so no two listings (or photos) share the same image.
 *
 * SAFETY: hard-refuses to run against anything that isn't local Supabase.
 *
 * Usage (local only):
 *   PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<local> npx tsx scripts/marketplace-real-photos.ts
 */

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const URL = process.env.PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// ── Safety: local only ────────────────────────────────────────
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) {
  console.error(`\n  REFUSING: PUBLIC_SUPABASE_URL is not local (got "${URL}").`);
  console.error('  This script only runs against local Supabase.\n');
  process.exit(1);
}
if (!KEY) { console.error('\n  Missing SUPABASE_SERVICE_ROLE_KEY.\n'); process.exit(1); }

const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// ── Category → LoremFlickr keyword candidates (tried in order) ──
const KEYWORDS: Record<string, string[]> = {
  cardigan: ['knitted,cardigan', 'knitted,sweater', 'wool,cardigan'],
  lue: ['knitted,beanie', 'knitted,hat', 'wool,hat'],
  bukser: ['knitted,baby', 'knitting,baby', 'wool,knitting'],
  sokker: ['knitted,socks', 'knitting,socks', 'wool,socks'],
  genser: ['knitted,sweater', 'knitting,jumper', 'wool,sweater'],
  teppe: ['knitted,blanket', 'crochet,blanket', 'knitting,blanket'],
  votter: ['knitted,mittens', 'knitting,mittens', 'wool,gloves'],
  kjole: ['knitted,dress', 'crochet,dress', 'knitting,baby'],
  annet: ['knitting,wool', 'knitted,baby', 'yarn,wool'],
};

const PHOTOS_PER_LISTING = 3;
const seenHashes = new Set<string>();
let lock = 1000; // global incrementing seed → distinct images

async function tryFetch(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 8000) return null; // reject tiny/error payloads
    return buf;
  } catch {
    return null;
  }
}

/** Fetch one unique image for a category; null only if everything fails. */
async function fetchUnique(category: string): Promise<{ buf: Buffer; source: string } | null> {
  const candidates = KEYWORDS[category] ?? KEYWORDS.annet;
  for (let attempt = 0; attempt < 9; attempt++) {
    const kw = candidates[attempt % candidates.length];
    const seed = lock++;
    const buf = await tryFetch(`https://loremflickr.com/800/800/${kw}?lock=${seed}`);
    if (buf) {
      const hash = createHash('sha256').update(buf).digest('hex');
      if (!seenHashes.has(hash)) { seenHashes.add(hash); return { buf, source: `loremflickr:${kw}:${seed}` }; }
    }
  }
  // Fallback: Picsum (always up; not knitting-specific) — keeps the >=3 guarantee.
  for (let attempt = 0; attempt < 4; attempt++) {
    const seed = lock++;
    const buf = await tryFetch(`https://picsum.photos/seed/knit${seed}/800/800`);
    if (buf) {
      const hash = createHash('sha256').update(buf).digest('hex');
      if (!seenHashes.has(hash)) { seenHashes.add(hash); return { buf, source: `picsum:${seed}` }; }
    }
  }
  return null;
}

async function main() {
  console.log('\n  Real-photo seeding (local) →', URL, '\n');

  const { data: listings, error } = await admin
    .from('listings')
    .select('id, title, category, seller_id')
    .order('created_at', { ascending: true });
  if (error || !listings?.length) { console.error('  No listings.', error?.message ?? ''); return; }

  let totalPhotos = 0;
  let fallbacks = 0;

  for (const l of listings) {
    // Clear existing photos (placeholders) — storage + rows.
    const { data: old } = await admin.from('listing_photos').select('path').eq('listing_id', l.id);
    if (old?.length) {
      await admin.storage.from('projects').remove(old.map((o) => o.path));
      await admin.from('listing_photos').delete().eq('listing_id', l.id);
    }

    const paths: string[] = [];
    for (let i = 0; i < PHOTOS_PER_LISTING; i++) {
      const img = await fetchUnique(l.category);
      if (!img) { console.log(`  ! ${l.title}: image ${i + 1} failed`); continue; }
      if (img.source.startsWith('picsum')) fallbacks++;
      const path = `${l.seller_id}/listings/${l.id}/photo-${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await admin.storage.from('projects').upload(path, img.buf, { contentType: 'image/jpeg', upsert: false });
      if (upErr) { console.log(`  ! ${l.title}: upload failed — ${upErr.message}`); continue; }
      await admin.from('listing_photos').insert({ listing_id: l.id, path, position: i });
      paths.push(path);
      totalPhotos++;
    }
    if (paths.length) {
      await admin.from('listings').update({ hero_photo_path: paths[0], photos: paths }).eq('id', l.id);
    }
    console.log(`  ✓ ${l.title} [${l.category}] — ${paths.length} photo(s)`);
  }

  console.log(`\n  Done: ${totalPhotos} photos across ${listings.length} listings`
    + ` (${seenHashes.size} unique images, ${fallbacks} non-knitting fallbacks).\n`);
}

main().catch((e) => { console.error('\nFailed:', e); process.exit(1); });
