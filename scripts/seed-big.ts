#!/usr/bin/env npx tsx
/**
 * Strikketorget — Big local seed
 *
 * Populates a clean local Supabase with a realistic dataset:
 *   - 20 users (12 sellers, 5 buyers, 2 moderators, 1 admin)
 *   - 12 stores in mixed states (active / pending_review / suspended)
 *   - 300 listings spread across users + stores in mixed statuses
 *     (active, pending_review, draft, sold, reserved, frozen, rejected)
 *   - Hero photos pulled from Unsplash (knitting collection)
 *   - 25 conversations with messages
 *   - 15 reports (mix of open, resolved, dismissed)
 *   - 3 active moderator threads on frozen items
 *   - Notifications spread across users
 *
 * Targets the LOCAL Supabase (reads .dev.vars / .env.local).
 * Idempotent only at the auth-user level — re-running will create new
 * listings/stores. To start fully clean, run scripts/snapshot-prod.sh or
 * truncate manually first.
 *
 * Usage:
 *   npx tsx scripts/seed-big.ts
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

// ─── Env loading (matches the other scripts) ────────────────────────────────
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
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
if (!SUPABASE_URL.includes('localhost') && !SUPABASE_URL.includes('127.0.0.1') && !SUPABASE_URL.match(/^http:\/\/(?:192|10|172)\./)) {
  console.error(`Refusing to seed: SUPABASE_URL doesn't look local (${SUPABASE_URL}). Aborting.`); process.exit(1);
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TRACE = (msg: string) => console.log(`  ${msg}`);

// ─── Deterministic-ish randomness ──────────────────────────────────────────
let seed = 1;
const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const maybe = (p: number) => rand() < p;
const shuffle = <T>(arr: T[]): T[] => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// ─── Norwegian name pools ──────────────────────────────────────────────────
const FIRST_NAMES_F = ['Kari', 'Ingrid', 'Solveig', 'Astrid', 'Maja', 'Liv', 'Marit', 'Nora', 'Sofie', 'Linn', 'Hanne', 'Trine', 'Anna', 'Mia', 'Hilde'];
const FIRST_NAMES_M = ['Lars', 'Ola', 'Erik', 'Bjørn', 'Henrik', 'Andreas', 'Sondre', 'Magnus', 'Tor'];
const LAST_NAMES = ['Hansen', 'Olsen', 'Nilsen', 'Berg', 'Lien', 'Solberg', 'Dahl', 'Eriksen', 'Holm', 'Strand', 'Lund', 'Aas', 'Bakke', 'Knudsen', 'Pettersen'];
const CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger', 'Tromsø', 'Drammen', 'Kristiansand', 'Bodø', 'Ålesund', 'Lillehammer', 'Hamar', 'Sandnes', 'Mo i Rana', 'Krokstadelva', 'Fredrikstad'];
const TAGLINES = [
  'Håndlagde plagg fra Vestlandet',
  'Strikket med kjærlighet',
  'Småskala, store følelser',
  'Barnetøy i ull og bomull',
  'Klassisk norsk håndverk',
  'Mor og mormor på samme verksted',
  'Strikk for hele familien',
  'Bestillingsstrikk siden 2018',
];

const STORE_NAMES = [
  'Strikkebua', 'Nøste & Tråd', 'Garn og Glede', 'Lillebror Knit', 'Krokstadelva Knits',
  'Snefugl Strikk', 'Mor Trine Designs', 'Hånd & Hjerte', 'Solstrekk', 'Vestkant Strikk',
  'Lille Ull', 'Skogsblomst', 'Fjordstrikk',
];

// ─── Listing data ──────────────────────────────────────────────────────────
const LISTING_TEMPLATES = [
  { title: 'Marius-genser', category: 'genser',   priceRange: [350, 950]  },
  { title: 'Babysokker',    category: 'sokker',   priceRange: [80, 220]   },
  { title: 'Strikket lue',  category: 'lue',      priceRange: [120, 320]  },
  { title: 'Cardigan',      category: 'cardigan', priceRange: [400, 1100] },
  { title: 'Vottesett',     category: 'votter',   priceRange: [150, 380]  },
  { title: 'Dåpskjole',     category: 'kjole',    priceRange: [550, 1400] },
  { title: 'Strikketeppe',  category: 'teppe',    priceRange: [600, 1600] },
  { title: 'Ulldress',      category: 'annet',    priceRange: [700, 1500] },
  { title: 'Skjerf',        category: 'annet',    priceRange: [180, 420]  },
  { title: 'Ulljakke',      category: 'cardigan', priceRange: [450, 1100] },
  { title: 'Tubeskjerf',    category: 'annet',    priceRange: [120, 300]  },
  { title: 'Babylue',       category: 'lue',      priceRange: [90, 220]   },
  { title: 'Strikkebukse',  category: 'bukser',   priceRange: [300, 750]  },
  { title: 'Pulsvarmere',   category: 'annet',    priceRange: [120, 280]  },
];

const COLORS = ['Lyseblå', 'Naturhvit', 'Mørkegrønn', 'Burgunder', 'Antrasitt', 'Camel', 'Rosenrød', 'Salviegrønn', 'Sandfarget', 'Petrol', 'Sennepsgul', 'Lyseblå/Hvit'];
const SIZE_LABELS = ['0–3 mnd', '3–6 mnd', '6–12 mnd', '1–2 år', '2–4 år', '4–6 år', '6–8 år', '8–10 år', '10–12 år', 'Voksen S', 'Voksen M', 'Voksen L'];
const KINDS = ['pre_loved', 'ready_made'];
const CONDITIONS = ['som_ny', 'lite_brukt', 'brukt', 'slitt'];
const DESC_FRAGMENTS = [
  'Strikket i 100% norsk ull.',
  'Brukt sparsomt, fortsatt i veldig god stand.',
  'Lite hull i ene ermet — kosmetisk.',
  'Vasket og klar til ny eier.',
  'Røykfritt og dyrefritt hjem.',
  'Pasningen er rommelig.',
  'Holder seg godt etter mange vask.',
  'Perfekt til kalde dager.',
  'Originalt designet av Strikkebua.',
];

// Photos come from loremflickr — serves tag-matched Flickr Creative-
// Commons photos. Each unique `random=` seed returns a different image,
// so we just bump a counter.
let photoSeedCounter = 1;
function nextPhotoUrl(): string {
  return `https://loremflickr.com/800/800/knitting,yarn,wool?random=${photoSeedCounter++}`;
}

// (kept around as legacy fallback in case loremflickr is down)
const UNSPLASH_PHOTOS = [
  'https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=900&q=80',
  'https://images.unsplash.com/photo-1615310748170-29d7088865ad?w=900&q=80',
  'https://images.unsplash.com/photo-1651342703853-2594571bb96a?w=900&q=80',
  'https://images.unsplash.com/photo-1550376026-7375b92bb318?w=900&q=80',
  'https://images.unsplash.com/photo-1612016293124-1636e3d99b6a?w=900&q=80',
  'https://images.unsplash.com/photo-1600369672890-ac00f1907858?w=900&q=80',
  'https://images.unsplash.com/photo-1557303696-f0a415dc1b3e?w=900&q=80',
  'https://images.unsplash.com/photo-1513890333407-6f85205e8ef2?w=900&q=80',
  'https://images.unsplash.com/photo-1544967919-44c1ef2f9e7a?w=900&q=80',
  'https://images.unsplash.com/photo-1530396333989-24c5b8f805dd?w=900&q=80',
  'https://images.unsplash.com/photo-1601814933824-fd0b574dd592?w=900&q=80',
  'https://images.unsplash.com/photo-1593806155060-4b9f97e3c2ad?w=900&q=80',
  'https://images.unsplash.com/photo-1604577608925-1f72b1fa5b3b?w=900&q=80',
  'https://images.unsplash.com/photo-1599056407101-7c557a4a0144?w=900&q=80',
  'https://images.unsplash.com/photo-1494578379344-d6c710782a3d?w=900&q=80',
  'https://images.unsplash.com/photo-1577712039509-99030cba74ea?w=900&q=80',
];

async function fetchKnittingPhoto(retries = 2): Promise<Buffer | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const url = nextPhotoUrl();
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 2000) continue; // too small → likely placeholder
      return buf;
    } catch { /* retry */ }
  }
  return null;
}

async function uploadPhoto(sellerId: string, listingId: string, kind: 'hero' | 'photo'): Promise<string | null> {
  const buf = await fetchKnittingPhoto();
  if (!buf) return null;
  const path = `${sellerId}/listings/${listingId}/${kind}-${randomUUID()}.jpg`;
  const { error } = await admin.storage.from('projects').upload(path, buf, {
    contentType: 'image/jpeg', upsert: false,
  });
  if (error) { TRACE(`! upload failed: ${error.message}`); return null; }
  return path;
}

async function uploadStoreImage(storeId: string, kind: 'logo' | 'banner'): Promise<string | null> {
  const buf = await fetchKnittingPhoto();
  if (!buf) return null;
  const path = `stores/${storeId}/${kind}-${randomUUID()}.jpg`;
  const { error } = await admin.storage.from('projects').upload(path, buf, {
    contentType: 'image/jpeg', upsert: false,
  });
  if (error) { TRACE(`! upload failed: ${error.message}`); return null; }
  return path;
}

// ─── User creation ─────────────────────────────────────────────────────────
interface SeedUser { id: string; email: string; display: string; role: string | null; city: string }

async function createUser(email: string, displayName: string, city: string, role: string | null): Promise<SeedUser | null> {
  const { data: existing } = await admin.from('profiles').select('id, role').eq('display_name', displayName).maybeSingle();
  if (existing) {
    TRACE(`= ${displayName} already exists`);
    return { id: existing.id, email, display: displayName, role: existing.role ?? null, city };
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: 'Sommer2026!',
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error || !created.user) { TRACE(`! createUser failed for ${email}: ${error?.message}`); return null; }

  // Profile row is usually inserted by an auth trigger; upsert to set fields we care about.
  // stripe_onboarded=true so seeded listings actually show the buy button —
  // the listing detail gates Kjøp on this flag.
  await admin.from('profiles').upsert({
    id: created.user.id,
    display_name: displayName,
    location: city,
    role,
    stripe_onboarded: true,
    profile_visible: true,
  }, { onConflict: 'id' });
  return { id: created.user.id, email, display: displayName, role, city };
}

// ─── Main seed ─────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Strikketorget — Big local seed                  ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`  Target: ${SUPABASE_URL}\n`);

  // 1. Users
  console.log('→ Users');
  const users: SeedUser[] = [];
  const roles: (string | null)[] = ['admin', 'moderator', 'moderator', ...new Array(17).fill(null)];
  for (let i = 0; i < 20; i++) {
    const isF = i % 3 !== 0;
    const first = pick(isF ? FIRST_NAMES_F : FIRST_NAMES_M);
    const last = pick(LAST_NAMES);
    const display = `${first} ${last}`;
    const slugify = (s: string) => s.toLowerCase()
      .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
      .replace(/[^a-z0-9]/g, '');
    const email = `${slugify(first)}.${slugify(last)}${i}@strikketest.no`;
    const u = await createUser(email, display, pick(CITIES), roles[i]);
    if (u) users.push(u);
  }
  console.log(`  ✓ ${users.length} users (admin + 2 moderators + 17 members)\n`);

  const sellers = users.filter(u => !u.role);
  if (sellers.length < 5) { console.error('Need at least 5 non-staff users'); return; }

  // 2. Stores
  console.log('→ Stores');
  const stores: { id: string; ownerId: string; status: string }[] = [];
  const STATUSES: { status: string; weight: number }[] = [
    { status: 'active', weight: 8 }, { status: 'pending_review', weight: 2 }, { status: 'suspended', weight: 1 },
  ];
  const expandStatus = STATUSES.flatMap(s => new Array(s.weight).fill(s.status));
  for (let i = 0; i < STORE_NAMES.length; i++) {
    const name = STORE_NAMES[i];
    const owner = pick(sellers);
    const status = expandStatus[i % expandStatus.length];
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    // Fake Norwegian orgnr (9 digits). Unique per store so we don't collide.
    const orgnr = `9${String(100000000 + i * 17 + between(1, 999)).padStart(8, '0').slice(-8)}`;
    const { data: store, error } = await admin.from('stores').insert({
      slug, name, tagline: pick(TAGLINES), location_city: owner.city, orgnr,
      legal_name: `${name} AS`,
      created_by: owner.id, status, verified: status === 'active' && maybe(0.5),
      contact_email: owner.email, accent_color: pick(['#C97B5D', '#7B9E89', '#A65D5D', '#5D7BA6']),
    }).select('id').single();
    if (error) { TRACE(`! ${name}: ${error.message}`); continue; }

    // Logo + banner
    const logoPath = await uploadStoreImage(store.id, 'logo');
    const bannerPath = await uploadStoreImage(store.id, 'banner');
    if (logoPath || bannerPath) {
      await admin.from('stores').update({ logo_path: logoPath, banner_path: bannerPath }).eq('id', store.id);
    }

    // Owner membership
    await admin.from('store_members').insert({ store_id: store.id, user_id: owner.id, role: 'owner' });
    // 0-2 extra members
    const extras = shuffle(sellers.filter(s => s.id !== owner.id)).slice(0, between(0, 2));
    for (const e of extras) {
      await admin.from('store_members').insert({
        store_id: store.id, user_id: e.id, role: pick(['admin', 'manager', 'contributor']),
      });
    }
    stores.push({ id: store.id, ownerId: owner.id, status });
    process.stdout.write('.');
  }
  console.log(`\n  ✓ ${stores.length} stores (${stores.filter(s => s.status === 'active').length} active, ${stores.filter(s => s.status === 'pending_review').length} pending, ${stores.filter(s => s.status === 'suspended').length} suspended)\n`);

  // 3. Listings (300)
  console.log('→ Listings (300)');
  const listings: { id: string; sellerId: string; storeId: string | null; status: string }[] = [];

  const LISTING_STATUS_DIST: { status: string; weight: number }[] = [
    { status: 'active', weight: 60 },
    { status: 'pending_review', weight: 8 },
    { status: 'draft', weight: 5 },
    { status: 'sold', weight: 12 },
    { status: 'reserved', weight: 4 },
    { status: 'shipped', weight: 3 },
    { status: 'rejected', weight: 3 },
    { status: 'removed', weight: 3 },
    { status: 'frozen', weight: 2 },
  ];
  const expandListingStatus = LISTING_STATUS_DIST.flatMap(s => new Array(s.weight).fill(s.status));

  let uploaded = 0;
  for (let i = 0; i < 300; i++) {
    const tpl = pick(LISTING_TEMPLATES);
    const seller = pick(sellers);
    // ~40% of listings belong to a store (only active stores)
    const useStore = maybe(0.4);
    const activeStores = stores.filter(s => s.status === 'active');
    const store = useStore && activeStores.length ? pick(activeStores) : null;
    const owner = store ? sellers.find(s => s.id === store.ownerId) ?? seller : seller;
    const status = pick(expandListingStatus);
    const price = between(tpl.priceRange[0], tpl.priceRange[1]);
    const color = pick(COLORS);
    const size = pick(SIZE_LABELS);
    const title = `${tpl.title} – ${color}, str. ${size}`;
    const desc = shuffle([...DESC_FRAGMENTS]).slice(0, between(2, 4)).join(' ');
    const kind = pick(KINDS);
    // DB constraint: pre_loved → condition required; ready_made → must be null.
    const condition = kind === 'pre_loved' ? pick(CONDITIONS) : null;

    // Most active listings use Trygg betaling so the buy button shows.
    // 80% Trygg betaling on, 20% off — the off branch demos the manual
    // "Marker som solgt" path.
    const escrowEnabled = ['sold', 'reserved', 'shipped'].includes(status) ? true : maybe(0.8);

    // Shipping option mix mirrors what real sellers would pick.
    const SHIPPING_PICKS: Array<{ id: string; nok: number; weight: number }> = [
      { id: 'small_parcel', nok: 76, weight: 5 },  // Norgespakke liten
      { id: 'small_letter', nok: 41, weight: 3 },  // Brev
      { id: 'large_parcel', nok: 140, weight: 2 }, // Norgespakke stor
      { id: 'free', nok: 0, weight: 1 },           // Henting / dekker selv
    ];
    const shippingExpanded = SHIPPING_PICKS.flatMap((s) => new Array(s.weight).fill(s));
    const shipping = pick(shippingExpanded);

    const insertData: Record<string, any> = {
      seller_id: owner.id,
      store_id: store?.id ?? null,
      kind,
      title,
      description: desc,
      price_nok: price,
      category: tpl.category,
      condition,
      colorway: color,
      size_label: size,
      status,
      location: owner.city,
      listing_fee_nok: 0,
      escrow_enabled: escrowEnabled,
      shipping_option: shipping.id,
      shipping_price_nok: shipping.nok,
    };

    if (['active', 'sold', 'reserved', 'shipped', 'frozen'].includes(status)) {
      insertData.published_at = new Date(Date.now() - between(0, 60) * 86400_000).toISOString();
    }
    if (status === 'sold' || status === 'reserved' || status === 'shipped') {
      const buyer = pick(sellers.filter(s => s.id !== owner.id));
      insertData.buyer_id = buyer.id;
      insertData.buyer_name = buyer.display;
      insertData.buyer_city = buyer.city;
      insertData.reserved_at = new Date(Date.now() - between(0, 30) * 86400_000).toISOString();
    }
    if (status === 'frozen') {
      insertData.pre_freeze_status = 'active';
      insertData.frozen_at = new Date().toISOString();
      insertData.frozen_reason = 'Mistanke om kopi av eksisterende design';
    }
    if (status === 'rejected') {
      insertData.moderation_notes = 'Bilder samsvarer ikke med beskrivelse.';
    }

    const { data: listing, error } = await admin.from('listings').insert(insertData).select('id').single();
    if (error) { TRACE(`! listing ${i}: ${error.message}`); continue; }

    listings.push({ id: listing.id, sellerId: owner.id, storeId: store?.id ?? null, status });

    // Photos: 1-5 per non-draft listing. Mirror the real upload flow —
    // every photo goes into `listing_photos`, and hero_photo_path tracks
    // whichever sits at position 0 (so the list-view hero matches the
    // detail-view gallery's first slide).
    if (status !== 'draft') {
      const count = between(1, 5);
      let firstPath: string | null = null;
      for (let p = 0; p < count; p++) {
        const path = await uploadPhoto(owner.id, listing.id, 'photo');
        if (!path) continue;
        if (firstPath === null) firstPath = path;
        await admin.from('listing_photos').insert({
          listing_id: listing.id, path, position: p, caption: null,
        });
      }
      if (firstPath) {
        await admin.from('listings').update({ hero_photo_path: firstPath }).eq('id', listing.id);
        uploaded++;
      }
    }
    if (i % 25 === 0 && i > 0) process.stdout.write(`  ${i}/300 (${uploaded} with photos)\n`);
  }
  console.log(`  ✓ ${listings.length} listings (${uploaded} with photos)\n`);

  // 4. Conversations + messages
  console.log('→ Conversations + messages');
  const activeListings = listings.filter(l => l.status === 'active');
  const SAMPLE_MSGS = [
    'Hei! Er denne fortsatt tilgjengelig?',
    'Hvor lang er den i livet?',
    'Kan jeg få noen flere bilder?',
    'Vipps fungerer fint for meg, hva er nummeret?',
    'Tusen takk! Sender betaling i kveld.',
    'Pent! Tror denne passer perfekt.',
    'Er det mulig å hente i Oslo?',
    'Hvilken garn er den strikket i?',
  ];
  let convCount = 0;
  for (let i = 0; i < 25 && activeListings.length; i++) {
    const l = pick(activeListings);
    const buyer = pick(sellers.filter(s => s.id !== l.sellerId));
    const { data: conv, error } = await admin.from('marketplace_conversations').insert({
      listing_id: l.id, buyer_id: buyer.id, seller_id: l.sellerId,
    }).select('id').single();
    if (error || !conv) continue;
    const turns = between(2, 5);
    for (let t = 0; t < turns; t++) {
      const sender = t % 2 === 0 ? buyer.id : l.sellerId;
      await admin.from('marketplace_messages').insert({
        conversation_id: conv.id, sender_id: sender, body: pick(SAMPLE_MSGS),
        read_at: t < turns - 2 ? new Date().toISOString() : null,
      });
    }
    convCount++;
  }
  console.log(`  ✓ ${convCount} conversations\n`);

  // 5. Reports
  console.log('→ Reports');
  const REPORT_REASONS = ['scam', 'inappropriate', 'wrong_category', 'spam', 'other'];
  const REPORT_DESCS = [
    'Bildene ser ut til å være tatt fra en annen butikk.',
    'Innholdet virker upassende.',
    'Tror denne hører hjemme i en annen kategori.',
    'Spam — selger har lagt ut samme annonse 10 ganger.',
    null, null, // some without description
  ];
  const targetPool: { type: string; id: string }[] = [
    ...listings.slice(0, 50).map(l => ({ type: 'listing', id: l.id })),
    ...stores.map(s => ({ type: 'store', id: s.id })),
  ];
  let reportCount = 0;
  const reportedSet = new Set<string>();
  for (let i = 0; i < 18; i++) {
    const t = pick(targetPool);
    const reporter = pick(sellers);
    const dedupeKey = `${t.id}:${reporter.id}`;
    if (reportedSet.has(dedupeKey)) continue;
    reportedSet.add(dedupeKey);
    const status = maybe(0.55) ? 'open' : (maybe(0.5) ? 'resolved' : 'dismissed');
    const { error } = await admin.from('reports').insert({
      reporter_id: reporter.id,
      target_type: t.type, target_id: t.id,
      reason: pick(REPORT_REASONS), description: pick(REPORT_DESCS),
      status, anonymous: maybe(0.25),
      resolved_at: status !== 'open' ? new Date().toISOString() : null,
    });
    if (!error) reportCount++;
  }
  console.log(`  ✓ ${reportCount} reports\n`);

  // 6. Active moderator threads on a few frozen listings
  console.log('→ Moderator threads');
  const frozen = listings.filter(l => l.status === 'frozen').slice(0, 3);
  const mods = users.filter(u => u.role === 'moderator' || u.role === 'admin');
  if (mods.length) {
    for (const l of frozen) {
      const mod = pick(mods);
      const { data: thread } = await admin.from('moderation_threads').insert({
        target_type: 'listing', target_id: l.id,
        recipient_id: l.sellerId,
      }).select('id').single();
      if (!thread) continue;
      await admin.from('moderation_messages').insert({
        thread_id: thread.id, sender_id: mod.id, is_moderator: true,
        body: 'Hei,\n\nVi har mottatt en rapport om annonsen din. Mens vi behandler saken er den midlertidig frosset. Kan du gi oss din side av saken?\n\nVennlig hilsen\nModeratorteamet',
      });
    }
  }
  console.log(`  ✓ ${frozen.length} moderator threads\n`);

  // 7. Notifications spread
  console.log('→ Notifications');
  let notifCount = 0;
  for (const u of sellers.slice(0, 8)) {
    const n = between(1, 4);
    for (let i = 0; i < n; i++) {
      const type = pick(['new_offer', 'new_message', 'listing_purchased', 'review_received', 'item_approved'] as const);
      const { error } = await admin.from('notifications').insert({
        user_id: u.id, type,
        title: 'Test-varsel',
        body: 'Dette er et autogenerert testvarsel.',
        url: '/inbox',
        read_at: maybe(0.3) ? new Date().toISOString() : null,
      });
      if (!error) notifCount++;
    }
  }
  console.log(`  ✓ ${notifCount} notifications\n`);

  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   ✓ Seed complete                                 ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`  Users:    ${users.length}`);
  console.log(`  Stores:   ${stores.length}`);
  console.log(`  Listings: ${listings.length}`);
  console.log(`  Reports:  ${reportCount}`);
  console.log(`  Threads:  ${frozen.length}`);
  console.log(`\n  Sign in with any user email, password: Sommer2026!\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
