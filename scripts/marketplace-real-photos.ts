#!/usr/bin/env npx tsx
/**
 * Replace seeded placeholder photos with REAL knitting/knitwear images from
 * Wikimedia Commons (CC-licensed, keyless, stable direct URLs — and actually
 * on-subject, unlike random keyword image services).
 *
 * For every listing: clears existing listing_photos (+ storage files), then
 * uploads >=3 category-matched real photos to the `projects` bucket, inserts
 * listing_photos rows, and sets hero_photo_path + photos[]. Images are JPEG
 * photos (diagrams/clipart/PNGs filtered out), deduped by content hash so no
 * two photos repeat. Cards fill via object-cover, so any real photo fills.
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

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) {
  console.error(`\n  REFUSING: PUBLIC_SUPABASE_URL is not local (got "${URL}"). Local only.\n`);
  process.exit(1);
}
if (!KEY) { console.error('\n  Missing SUPABASE_SERVICE_ROLE_KEY.\n'); process.exit(1); }

const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// Category → Commons full-text search queries (tried in order, with paging).
const QUERIES: Record<string, string[]> = {
  cardigan: ['knitted cardigan', 'knit cardigan', 'knitted jacket wool'],
  lue: ['knitted hat', 'knitted cap wool', 'knitted beanie'],
  bukser: ['knitted baby clothes', 'knitted leggings', 'knitted trousers baby'],
  sokker: ['knitted socks', 'wool socks handknit', 'knitted sock'],
  genser: ['knitted sweater', 'knitted pullover', 'wool jumper handknit'],
  teppe: ['knitted blanket', 'crochet blanket', 'knitted afghan'],
  votter: ['knitted mittens', 'wool mittens', 'knitted gloves'],
  kjole: ['knitted dress', 'crochet dress', 'knitted baby dress'],
  annet: ['knitted baby clothes', 'hand knitting wool', 'knitwear handmade'],
};

const BAD_TITLE = /PSF|diagram|chart|schematic|pattern|logo|icon|\.svg|machine|loom|graph|symbol|stitch chart/i;
const PHOTOS_PER_LISTING = 3;
const UA = 'littlesandme-local-seed/1.0 (dev mock data; contact admin@littlesandmeknits.com)';

interface Cand { url: string; }
const seenHashes = new Set<string>();

async function commonsCandidates(query: string, offset = 0, limit = 20): Promise<string[]> {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&generator=search`
    + `&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=${limit}&gsroffset=${offset}`
    + `&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=800&format=json`;
  try {
    const res = await fetch(api, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) return [];
    const data: any = await res.json();
    const pages = data?.query?.pages ?? {};
    const out: string[] = [];
    for (const p of Object.values<any>(pages)) {
      const ii = p?.imageinfo?.[0];
      if (!ii || ii.mime !== 'image/jpeg' || !ii.thumburl) continue;
      if (BAD_TITLE.test(p.title ?? '')) continue;
      const ratio = (ii.thumbheight ?? 1) / (ii.thumbwidth ?? 1);
      if (ratio < 0.4 || ratio > 2.6) continue; // skip extreme aspect ratios
      out.push(ii.thumburl);
    }
    return out;
  } catch {
    return [];
  }
}

/** Build a deduped candidate-URL pool for a category (enough for its listings). */
async function buildPool(category: string, need: number): Promise<string[]> {
  const queries = QUERIES[category] ?? QUERIES.annet;
  const urls: string[] = [];
  const seenUrl = new Set<string>();
  for (const q of queries) {
    for (let offset = 0; offset < 60 && urls.length < need + 6; offset += 20) {
      const cands = await commonsCandidates(q, offset);
      for (const u of cands) if (!seenUrl.has(u)) { seenUrl.add(u); urls.push(u); }
      if (cands.length < 20) break; // no more results for this query
    }
    if (urls.length >= need + 6) break;
  }
  return urls;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Wikimedia throttles rapid downloads from upload.wikimedia.org — pace + retry.
async function download(url: string): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
      if (res.status === 429 || res.status >= 500) continue; // throttled / transient → retry
      if (!res.ok) return null;
      if (!(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length >= 8000) return buf;
    } catch { /* timeout/network → retry */ }
  }
  return null;
}

async function main() {
  console.log('\n  Real-photo seeding from Wikimedia Commons (local) →', URL, '\n');

  const { data: listings, error } = await admin
    .from('listings').select('id, title, category, seller_id').order('created_at', { ascending: true });
  if (error || !listings?.length) { console.error('  No listings.', error?.message ?? ''); return; }

  // Group by category and build pools sized to demand.
  const byCat: Record<string, typeof listings> = {};
  for (const l of listings) (byCat[l.category] ??= []).push(l);
  const pools: Record<string, string[]> = {};
  for (const [cat, ls] of Object.entries(byCat)) {
    pools[cat] = await buildPool(cat, ls.length * PHOTOS_PER_LISTING);
    console.log(`  pool[${cat}]: ${pools[cat].length} candidates for ${ls.length} listing(s)`);
  }

  let totalPhotos = 0, shortfalls = 0;
  for (const l of listings) {
    const { data: old } = await admin.from('listing_photos').select('path').eq('listing_id', l.id);
    if (old?.length) {
      await admin.storage.from('projects').remove(old.map((o) => o.path));
      await admin.from('listing_photos').delete().eq('listing_id', l.id);
    }

    const pool = pools[l.category] ?? [];
    const paths: string[] = [];
    while (paths.length < PHOTOS_PER_LISTING && pool.length) {
      const url = pool.shift()!;
      await sleep(400); // pace downloads to stay under Wikimedia's rate limit
      const buf = await download(url);
      if (!buf) continue;
      const hash = createHash('sha256').update(buf).digest('hex');
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);
      const path = `${l.seller_id}/listings/${l.id}/photo-${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await admin.storage.from('projects').upload(path, buf, { contentType: 'image/jpeg', upsert: false });
      if (upErr) { console.log(`  ! ${l.title}: upload — ${upErr.message}`); continue; }
      await admin.from('listing_photos').insert({ listing_id: l.id, path, position: paths.length });
      paths.push(path);
      totalPhotos++;
    }
    if (paths.length) await admin.from('listings').update({ hero_photo_path: paths[0], photos: paths }).eq('id', l.id);
    if (paths.length < PHOTOS_PER_LISTING) shortfalls++;
    console.log(`  ${paths.length >= PHOTOS_PER_LISTING ? '✓' : '⚠'} ${l.title} [${l.category}] — ${paths.length} photo(s)`);
  }

  console.log(`\n  Done: ${totalPhotos} photos, ${seenHashes.size} unique`
    + (shortfalls ? `, ${shortfalls} listing(s) under ${PHOTOS_PER_LISTING}` : '') + '.\n');
}

main().catch((e) => { console.error('\nFailed:', e); process.exit(1); });
