#!/usr/bin/env npx tsx
/**
 * Uploads mock photos to test listings in Supabase storage.
 * Run after marketplace-seed.ts.
 *
 * Usage:
 *   npx tsx scripts/marketplace-photos.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  Object.entries(process.env).forEach(([k, v]) => { if (v) result[k] = v; });
  for (const file of ['.env.local', '.env', '.dev.vars']) {
    try {
      for (const line of readFileSync(resolve(process.cwd(), file), 'utf-8').split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"#]*)"?\s*$/);
        if (m) result[m[1].trim()] = m[2].trim();
      }
    } catch {}
  }
  return result;
}

const env = loadEnv();
const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('\n  Missing env vars.\n');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PHOTO_DIR = '/tmp/knit-photos';

// Map: partial title match → list of local filenames to upload
const PHOTO_MAP: [string, string[]][] = [
  ['Sondre cardigan', ['cardigan1.jpg', 'knits1.jpg']],
  ['Wilma lue', ['beanie1.jpg']],
  ['Ribbestrikket bukse', ['hat1.jpg']],
  ['Babysokker', ['socks1.jpg', 'woolsocks1.jpg']],
  ['Solskinn-genser', ['sweater1.jpg']],
  ['Sjøgras-teppe', ['blanket1.jpg', 'blanket2.jpg']],
  ['Skog cardigan', ['outfit1.jpg']],
  ['Vottesett med tommel', ['mittens1.jpg']],
  ['dåpskjole', ['babydress1.jpg']],
  ['babydrakt', ['hat1.jpg']],
  ['Babyvotter', ['mittens1.jpg']],
  ['ragglue', ['hatscarf1.jpg']],
  ['strikkeluffer', ['mittens1.jpg']],
  ['Ulldress med raglan', ['sweater2.jpg']],
  ['genser str. 104', ['sweater1.jpg']],
  ['ringesnurr', ['woolsocks1.jpg']],
  ['Ulljakke med knapper', ['knits1.jpg']],
  ['sommerkjole', ['babydress1.jpg']],
  ['Marius-genser', ['fairisle1.jpg']],
  ['lue og skjerf sett', ['hatscarf1.jpg', 'beanie1.jpg']],
  ['Babyteppe i bomull', ['blanket2.jpg']],
  ['cardigan str. 74', ['cardigan1.jpg']],
  ['Morgen-sett', ['sweater2.jpg', 'knits1.jpg']],
  ['Ullsokker str. 4–6', ['socks1.jpg']],
];

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║     Strikketorget — Photo Upload                  ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  const { data: listings } = await admin
    .from('listings')
    .select('id, title, seller_id, photos')
    .order('created_at', { ascending: true });

  if (!listings || listings.length === 0) {
    console.log('  No listings found. Run marketplace-seed.ts first.\n');
    return;
  }

  let uploaded = 0;
  let skipped = 0;

  for (const listing of listings) {
    if ((listing.photos ?? []).length > 0) {
      skipped++;
      continue;
    }

    const match = PHOTO_MAP.find(([pattern]) =>
      listing.title.toLowerCase().includes(pattern.toLowerCase())
    );
    if (!match) continue;

    const [, files] = match;
    const photoPaths: string[] = [];

    for (const file of files) {
      try {
        const filePath = resolve(PHOTO_DIR, file);
        const buffer = readFileSync(filePath);
        const storagePath = `${listing.seller_id}/listings/${listing.id}/photo-${crypto.randomUUID()}.jpg`;

        const { error } = await admin.storage
          .from('projects')
          .upload(storagePath, buffer, { contentType: 'image/jpeg', upsert: false });

        if (error) {
          console.log(`  \x1b[33m!\x1b[0m ${listing.title}: upload failed — ${error.message}`);
          continue;
        }
        photoPaths.push(storagePath);
      } catch (e: any) {
        console.log(`  \x1b[33m!\x1b[0m ${listing.title}: ${e.message}`);
      }
    }

    if (photoPaths.length > 0) {
      await admin
        .from('listings')
        .update({ photos: photoPaths, hero_photo_path: photoPaths[0] })
        .eq('id', listing.id);
      console.log(`  \x1b[32m✓\x1b[0m ${listing.title} — ${photoPaths.length} photo(s)`);
      uploaded += photoPaths.length;
    }
  }

  console.log(`\n  Uploaded: ${uploaded} photos`);
  if (skipped > 0) console.log(`  Skipped: ${skipped} listings (already have photos)`);
  console.log();
}

main().catch((err) => {
  console.error('\nPhoto upload failed:', err);
  process.exit(1);
});
