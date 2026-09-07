// Dev-only comprehensive seeder. Layers a full, believable, relational world on
// top of seedWorld() so EVERY part of the app can be reviewed against realistic
// content, with a category-relevant image on every visual entity.
//
// Run order matters: this seeds ROWS (which reference images under
// projects/_samples/*). The image BYTES are hydrated separately by
// `npm run seed:samples` (scripts/seed-sample-images.mjs), which must run AFTER
// this because the internal `cleanup` step wipes the storage bucket. The
// `npm run seed:full` orchestrator (scripts/seed-full.mjs) does both in order.
//
// Idempotent: re-running is safe. seedWorld() runs `cleanup` first, which sweeps
// the whole @test.strikketorget.no domain (including everything this file adds —
// favorites, seeded dead-letter events, extra personas, stores, studio data), so
// a re-run rebuilds rather than duplicates.
//
// LOCAL ONLY: the entry point (the `seed-full` action in test-exec) runs against
// whatever Supabase the Worker is bound to; the npm orchestrator refuses a
// non-local URL. This module itself does no network guard — it's reached only
// through the dev-guarded endpoint.
//
// This is dev tooling, so it writes some rows directly (the allowed /api/dev/*
// exception). Money/commission/listing lifecycles still go through real services
// via seedWorld + the `handle()` switch.

import type { createAdminSupabase } from '../supabase';
import type { Database } from '../database.types';

type NotifType = Database['public']['Tables']['notifications']['Insert']['type'];
type ListingCategory = Database['public']['Tables']['listings']['Insert']['category'];
import { seedWorld } from './seed-world';
import { seedProfile } from './seed-profile';
import {
  heroSample, nextPhotos,
  AVATAR_SAMPLES, STORE_LOGO_SAMPLES, STORE_BANNER_SAMPLES,
} from './sample-images';
import { CATEGORY_LABEL } from '../labels';

type Db = ReturnType<typeof createAdminSupabase>;
type Handle = (db: Db, action: string, actorId: string | null, p: Record<string, unknown>, emailToId: Map<string, string>) => Promise<{ data?: unknown }>;

const D = '@test.strikketorget.no';

// Extra personas layered on top of seedWorld's cast (eline, maja, liv, kari,
// nora, ingrid, solveig, hanne, silje).
const EX = {
  astrid: `astrid${D}`,  // store owner (second store)
  bjorn: `bjorn${D}`,    // store member / contributor
  tuva: `tuva${D}`,      // buyer + hobby knitter (rich studio)
} as const;

const PERSONA_META: Record<string, { name: string; location: string; bio: string; avatar: string }> = {
  [`eline${D}`]:   { name: 'Eline Berg', location: 'Oslo', bio: 'Strikker barneplagg i naturfiber. Selger overskudd og tar oppdrag.', avatar: AVATAR_SAMPLES[0] },
  [`maja${D}`]:    { name: 'Maja Lund', location: 'Bergen', bio: 'Fersk selger, lærer meg torget. Elsker farger og mønster.', avatar: AVATAR_SAMPLES[1] },
  [`liv${D}`]:     { name: 'Liv Johansen', location: 'Oslo', bio: 'Småbarnsmor på jakt etter håndlaget til de minste.', avatar: AVATAR_SAMPLES[2] },
  [`kari${D}`]:    { name: 'Kari Ness', location: 'Trondheim', bio: 'Samler på ull og fine kofter. Moderator på torget.', avatar: AVATAR_SAMPLES[3] },
  [`nora${D}`]:    { name: 'Nora Dahl', location: 'Bergen', bio: 'Liker klassisk norsk strikk. Passer på at alt går riktig for seg.', avatar: AVATAR_SAMPLES[4] },
  [`ingrid${D}`]:  { name: 'Ingrid Moen', location: 'Stavanger', bio: 'Erfaren strikker, tar imot oppdrag. Mønsterstrikk er spesialiteten.', avatar: AVATAR_SAMPLES[5] },
  [`solveig${D}`]: { name: 'Solveig Vik', location: 'Tromsø', bio: 'Strikker teppe og babyplagg av økologisk merino.', avatar: AVATAR_SAMPLES[0] },
  [EX.astrid]:     { name: 'Astrid Haug', location: 'Ålesund', bio: 'Driver Tråd & Tone, en liten strikkebutikk på Sunnmøre.', avatar: AVATAR_SAMPLES[1] },
  [EX.bjorn]:      { name: 'Bjørn Sæther', location: 'Ålesund', bio: 'Strikker herreplagg og bidrar i butikken Tråd & Tone.', avatar: AVATAR_SAMPLES[2] },
  [EX.tuva]:       { name: 'Tuva Lie', location: 'Drammen', bio: 'Hobbystrikker med altfor stort garnlager. Deler prosjektene mine.', avatar: AVATAR_SAMPLES[3] },
};

// Every category × kind, spread across statuses/conditions/shipping so the grids
// (brukt/nytt/index) show a full catalogue. Titles are Norwegian and unique.
const CONDITIONS = ['som_ny', 'lite_brukt', 'brukt', 'slitt'] as const;
const SHIPPING = [
  { option: 'free', price: 0 },
  { option: 'small_letter', price: 59 },
  { option: 'small_parcel', price: 89 },
  { option: 'parcel', price: 129 },
];

export async function seedFull(deps: { db: Db; handle: Handle; emailToId: Map<string, string> }): Promise<Record<string, number>> {
  const { db, handle, emailToId } = deps;

  // ── 0. Base world (personas, listings, commissions, disputes, one store, …).
  //     Runs `cleanup` internally, so everything below lands on a clean slate.
  const base = await seedWorld(deps);

  const counts: Record<string, number> = { ...base };
  const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
  const id = (email: string) => emailToId.get(email);

  // Local ensure for the extra personas (mirrors seed-world's, with retry for a
  // cold GoTrue right after db reset).
  async function ensure(email: string): Promise<string> {
    let uid = emailToId.get(email);
    if (!uid) {
      let lastErr = 'unknown';
      for (let attempt = 0; attempt < 5 && !uid; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
        const { data: created, error } = await db.auth.admin.createUser({
          email, email_confirm: true, user_metadata: { display_name: PERSONA_META[email]?.name ?? email },
        });
        if (created?.user) { uid = created.user.id; break; }
        lastErr = error?.message || JSON.stringify(error ?? {});
      }
      if (!uid) throw new Error(`create user ${email} after retries: ${lastErr}`);
      emailToId.set(email, uid);
    }
    return uid;
  }
  for (const email of Object.values(EX)) await ensure(email);

  // ── 1. Identity: bio + location + avatar on every persona (so the avatar UI,
  //     profile headers and seller cards all show believable content).
  for (const [email, meta] of Object.entries(PERSONA_META)) {
    const uid = id(email);
    if (!uid) continue;
    await db.from('profiles').update({
      display_name: meta.name, location: meta.location, bio: meta.bio,
      avatar_path: meta.avatar, profile_visible: true,
    }).eq('id', uid);
    bump('profiles_enriched');
  }

  // Per-category rotation (shared with seedWorld via nextPhotos) so consecutive
  // same-category cards don't repeat the same photo. (For fully-unique real
  // photos per listing, run `npm run seed:photos`, which the `npm run seed:full`
  // orchestrator does after the rows are seeded.)
  /** (Re)attach rotated category-relevant sample photos + hero for a listing. */
  async function attachPhotos(listingId: string, category: string, count = 2): Promise<void> {
    const paths = nextPhotos(category, count);
    // Delete-then-insert so this is safe to call after create-listing (which has
    // already attached its own photos) without piling up duplicate rows.
    await db.from('listing_photos').delete().eq('listing_id', listingId);
    for (let i = 0; i < paths.length; i++) {
      await db.from('listing_photos').insert({ listing_id: listingId, path: paths[i], position: i });
    }
    await db.from('listings').update({ hero_photo_path: paths[0], photos: paths }).eq('id', listingId);
  }

  // ── 2. Full catalogue: every category × kind, varied status/condition/shipping.
  //     Sellers rotate across eline/ingrid/solveig/maja/tuva. These are inserted
  //     directly (draft/active/removed are display states, not money flows).
  const categories = Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]; // genser, cardigan, lue, …
  const sellers = [`eline${D}`, `ingrid${D}`, `solveig${D}`, `maja${D}`, EX.tuva];
  const STATUSES = ['active', 'active', 'active', 'draft', 'removed'] as const;
  const SIZES = ['0-6 mnd', '1 år', '2 år', '3 år', '4 år', '6 år'];
  // A colour/detail per listing so no two catalogue cards share a title, and the
  // grid reads like real, individually-listed items rather than a template.
  const COLORS = [
    'rosa', 'lys blå', 'natur', 'koksgrå', 'sennepsgul', 'petrol',
    'burgunder', 'offwhite', 'lys grønn', 'terracotta', 'lilla', 'sennep',
    'marineblå', 'kremhvit', 'skogsgrønn', 'støvet rosa', 'okergul', 'gråmelert',
  ];
  let catIdx = 0;
  for (const category of categories) {
    for (const kind of ['ready_made', 'pre_loved'] as const) {
      const seller = sellers[catIdx % sellers.length];
      const sellerId = id(seller)!;
      const status = STATUSES[catIdx % STATUSES.length];
      const ship = SHIPPING[catIdx % SHIPPING.length];
      // Spread prices so no two cards share a price either (49 kr steps).
      const price = 119 + catIdx * 47;
      const color = COLORS[catIdx % COLORS.length];
      const size = SIZES[catIdx % SIZES.length];
      const kindLabel = kind === 'ready_made' ? 'Nystrikket' : 'Pent brukt';
      const { data: l, error } = await db.from('listings').insert({
        seller_id: sellerId,
        kind,
        title: `${kindLabel} ${CATEGORY_LABEL[category].toLowerCase()} i ${color} (${size})`,
        category: category as ListingCategory,
        size_label: size,
        price_nok: price,
        condition: kind === 'ready_made' ? null : CONDITIONS[catIdx % CONDITIONS.length],
        description: `Håndstrikket ${CATEGORY_LABEL[category].toLowerCase()} i ${color}, størrelse ${size}. Testdata fra den store seeden.`,
        status,
        published_at: status === 'active' ? new Date().toISOString() : null,
        escrow_enabled: catIdx % 2 === 0,
        shipping_option: ship.option,
        shipping_price_nok: ship.price,
        listing_fee_nok: status === 'active' ? 29 : null,
      }).select('id').single();
      if (error) throw new Error(`seed-full catalogue insert (${category}/${kind}): ${error.message}`);
      await attachPhotos(l.id, category, kind === 'ready_made' ? 3 : 2);
      bump('catalogue_listings');
      if (status === 'draft') bump('catalogue_drafts');
      if (status === 'removed') bump('catalogue_removed');
      catIdx++;
    }
  }

  // Promote a couple of active listings (denormalised promo fields drive sort).
  const { data: activeForPromo } = await db.from('listings')
    .select('id').eq('status', 'active').in('seller_id', [id(`eline${D}`)!, id(`ingrid${D}`)!])
    .limit(2);
  const weekAhead = new Date(Date.now() + 7 * 86400_000).toISOString();
  for (const [i, row] of (activeForPromo ?? []).entries()) {
    await db.from('listings').update({
      promoted_until: weekAhead, promotion_tier: i === 0 ? 'premium' : 'basic',
    }).eq('id', row.id);
    bump('promoted');
  }

  // ── 3. Studio dashboards: projects (every status), yarn (all weights),
  //     needles, library, purchases, badges — for a spread of personas. Reuse
  //     the battle-tested seedProfile for the bulk, then add what it skips.
  for (const email of [`eline${D}`, `ingrid${D}`, `solveig${D}`, EX.tuva]) {
    const uid = id(email);
    if (!uid) continue;
    // skipListings: seed-full owns each persona's seller listings (varied
    // titles/prices/images via the catalogue above). Letting seedProfile emit
    // its four fixed specs once per persona is exactly what produced the
    // identical duplicate cards the owner flagged.
    await seedProfile({ db, userId: uid, skipListings: true });
    bump('studios');
  }

  // 3b. Needles (seedProfile skips these) + a frogged project + a project→yarn
  //     link so the stash, needle inventory and yarn-deduction path all show.
  const NEEDLE_SPECS = [
    { needle_type: 'circular', size_mm: 3.5, length_cm: 80, material: 'Bambus', brand: 'KnitPro' },
    { needle_type: 'circular', size_mm: 4.0, length_cm: 40, material: 'Metall', brand: 'Addi' },
    { needle_type: 'dpn', size_mm: 2.5, length_cm: 20, material: 'Tre', brand: 'Sandnes' },
    { needle_type: 'straight', size_mm: 5.0, length_cm: 35, material: 'Bambus', brand: 'Prym' },
  ];
  for (const email of [`eline${D}`, `ingrid${D}`, EX.tuva]) {
    const uid = id(email);
    if (!uid) continue;
    // Idempotency backstop (cleanup already sweeps needles): skip if present.
    const { data: existingN } = await db.from('needles').select('id').eq('user_id', uid).limit(1).maybeSingle();
    if (existingN) continue;
    for (const n of NEEDLE_SPECS) {
      await db.from('needles').insert({ user_id: uid, ...n, notes: 'Testdata.' });
      bump('needles');
    }
  }

  // Frogged project + a finished project consuming yarn (project_yarns).
  {
    const uid = id(EX.tuva)!;
    const { data: froggedExisting } = await db.from('projects')
      .select('id').eq('user_id', uid).eq('title', 'Kofte som røk opp').maybeSingle();
    if (!froggedExisting) {
      await db.from('projects').insert({
        user_id: uid, title: 'Kofte som røk opp', status: 'frogged',
        summary: 'Feil størrelse, rekket opp og bruker garnet på nytt.',
        hero_photo_path: heroSample('cardigan'),
        started_at: new Date(Date.now() - 40 * 86400_000).toISOString().slice(0, 10),
      });
      bump('projects_extra');
    }
    // Link a finished project to a stash yarn (grams_used) so the deduction path
    // has data. seedProfile made both for tuva.
    const { data: fin } = await db.from('projects')
      .select('id').eq('user_id', uid).eq('status', 'finished').limit(1).maybeSingle();
    const { data: yarn } = await db.from('yarns').select('id').eq('user_id', uid).limit(1).maybeSingle();
    if (fin && yarn) {
      const { data: linkExists } = await db.from('project_yarns')
        .select('id').eq('project_id', fin.id).eq('yarn_id', yarn.id).maybeSingle();
      if (!linkExists) {
        await db.from('project_yarns').insert({
          project_id: fin.id, yarn_id: yarn.id, grams_used: 220,
          deducted_at: new Date().toISOString(),
        });
        bump('project_yarns');
      }
    }
  }

  // ── 4. Favorites: buyers heart active listings + a commission request.
  const buyers = [`liv${D}`, `kari${D}`, `nora${D}`, EX.tuva];
  const buyerIds = buyers.map(id).filter((x): x is string => !!x);
  // cleanup doesn't sweep favorites; delete-then-insert keeps this idempotent.
  await db.from('favorites').delete().in('user_id', buyerIds);
  const { data: favListings } = await db.from('listings')
    .select('id').eq('status', 'active').limit(12);
  const { data: favReq } = await db.from('commission_requests')
    .select('id').eq('status', 'open').limit(3);
  for (const b of buyerIds) {
    const picks = (favListings ?? []).filter((_, i) => (i + b.charCodeAt(0)) % 3 === 0).slice(0, 4);
    for (const l of picks) {
      await db.from('favorites').insert({ user_id: b, item_type: 'listing', item_id: l.id });
      bump('favorites');
    }
    const rq = (favReq ?? [])[b.charCodeAt(1) % Math.max(1, (favReq ?? []).length)];
    if (rq) {
      await db.from('favorites').insert({ user_id: b, item_type: 'commission_request', item_id: rq.id });
      bump('favorites');
    }
  }

  // ── 5. Conversations with a READ two-way thread (seed-world already leaves
  //     unread buyer→seller messages). Reply as the seller + mark read so the
  //     inbox shows both states.
  {
    const { data: firstActive } = await db.from('listings')
      .select('id, seller_id, title').eq('seller_id', id(`eline${D}`)!).eq('status', 'active')
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    const buyerId = id(`kari${D}`)!;
    if (firstActive && buyerId) {
      // Idempotent: reuse conv if present.
      let convId: string;
      const { data: existingConv } = await db.from('marketplace_conversations')
        .select('id').eq('listing_id', firstActive.id).eq('buyer_id', buyerId).maybeSingle();
      if (existingConv) {
        convId = existingConv.id;
      } else {
        const { data: conv } = await db.from('marketplace_conversations')
          .insert({ listing_id: firstActive.id, buyer_id: buyerId, seller_id: firstActive.seller_id })
          .select('id').single();
        convId = conv!.id;
      }
      const nowIso = new Date().toISOString();
      await db.from('marketplace_messages').insert([
        { conversation_id: convId, sender_id: buyerId, body: 'Hei! Er denne fortsatt ledig? Kan du sende til Trondheim?', read_at: nowIso },
        { conversation_id: convId, sender_id: firstActive.seller_id, body: 'Hei! Ja, den er ledig. Jeg sender gjerne til Trondheim.', read_at: nowIso },
        { conversation_id: convId, sender_id: buyerId, body: 'Så fint, da kjøper jeg. Tusen takk!', read_at: nowIso },
      ]);
      bump('read_conversations');
    }
  }

  // ── 6. Second store (astrid owner) with members, a pending invite,
  //     store-owned listings (with photos), logo/banner, and a Connect status
  //     spread. seedWorld already made elines-strikk; enrich that one too.
  const astridId = id(EX.astrid)!;
  const bjornId = id(EX.bjorn)!;
  const elineId = id(`eline${D}`)!;

  // Enrich the first store from seed-world (logo/banner + verified Connect).
  const { data: store1 } = await db.from('stores').select('id').eq('slug', 'elines-strikk').maybeSingle();
  if (store1) {
    await db.from('stores').update({
      logo_path: STORE_LOGO_SAMPLES[0], banner_path: STORE_BANNER_SAMPLES[0],
      description: 'Håndstrikkede barneplagg i naturfiber, laget i små serier.',
      accent_color: '#B4694E', location_city: 'Oslo',
      stripe_account_id: 'acct_test_store1', stripe_connect_status: 'verified', stripe_onboarded: true,
    }).eq('id', store1.id);
    bump('stores_enriched');
  }

  // Second store: create via the service-driven action, then enrich.
  const { data: existing2 } = await db.from('stores').select('id').eq('slug', 'trad-og-tone').maybeSingle();
  let store2Id: string;
  if (existing2) {
    store2Id = existing2.id;
  } else {
    const res = await handle(db, 'seed-store', astridId, { slug: 'trad-og-tone', name: 'Tråd & Tone', orgnr: '912345678' }, emailToId);
    store2Id = (res.data as { storeId: string }).storeId;
    bump('stores_created');
  }
  await db.from('stores').update({
    logo_path: STORE_LOGO_SAMPLES[1], banner_path: STORE_BANNER_SAMPLES[1],
    tagline: 'Strikk fra Sunnmøre.', description: 'Liten butikk drevet av to strikkere. Vi tar også imot oppdrag.',
    accent_color: '#7C8B6B', location_city: 'Ålesund', contact_email: 'hei@trad-og-tone.no',
    // A restricted Connect account: shows the "needs more info" state in admin.
    stripe_account_id: 'acct_test_store2', stripe_connect_status: 'restricted', stripe_onboarded: false,
    stripe_connect_requirements: { currently_due: ['individual.verification.document'], disabled_reason: 'requirements.past_due' },
  }).eq('id', store2Id);

  // Members: bjorn (contributor, visible) + eline (manager, visible).
  for (const [uid, role, title] of [[bjornId, 'contributor', 'Herrestrikk'], [elineId, 'manager', 'Butikkansvarlig']] as const) {
    const { data: memExists } = await db.from('store_members')
      .select('id').eq('store_id', store2Id).eq('user_id', uid).maybeSingle();
    if (!memExists) {
      await db.from('store_members').insert({
        store_id: store2Id, user_id: uid, role, visible_on_storefront: true,
        public_title: title, invited_by: astridId,
      });
      bump('store_members');
    }
  }

  // A pending invitation (unaccepted) + the in-app notification an invitee gets.
  const inviteEmail = `solveig${D}`;
  const { data: invExists } = await db.from('store_invitations')
    .select('id').eq('store_id', store2Id).eq('email', inviteEmail).is('accepted_at', null).maybeSingle();
  if (!invExists) {
    await db.from('store_invitations').insert({
      store_id: store2Id, email: inviteEmail, role: 'contributor',
      token: `seed-invite-${crypto.randomUUID()}`,
      expires_at: new Date(Date.now() + 14 * 86400_000).toISOString(), invited_by: astridId,
    });
    bump('store_invites');
    const solveigId = id(inviteEmail);
    if (solveigId) {
      await db.from('notifications').insert({
        user_id: solveigId, type: 'store_invite', title: 'Invitasjon til butikk',
        body: 'Tråd & Tone har invitert deg som bidragsyter.',
        url: '/profile/stores', actor_id: astridId,
      });
    }
  }

  // Store-owned listings (create via the real create-listing action for photos,
  // then attach to the store).
  const storeCats: [string, string][] = [['genser', 'ready_made'], ['lue', 'ready_made'], ['votter', 'pre_loved']];
  const { count: existingStoreListings } = await db.from('listings')
    .select('id', { count: 'exact', head: true }).eq('store_id', store2Id);
  if ((existingStoreListings ?? 0) === 0) {
    let sc = 0;
    for (const [category, kind] of storeCats) {
      const seller = sc % 2 === 0 ? astridId : bjornId;
      const created = await handle(db, 'create-listing', seller, {
        title: `Tråd & Tone: ${CATEGORY_LABEL[category].toLowerCase()}`, kind, category,
        size_label: SIZES[sc % SIZES.length], price_nok: 299 + sc * 40,
        escrow_enabled: true, photo_count: 3, condition: kind === 'ready_made' ? null : 'som_ny',
      }, emailToId);
      const listingId = (created.data as { id: string }).id;
      await db.from('listings').update({
        store_id: store2Id, status: 'active', published_at: new Date().toISOString(), listing_fee_nok: 29,
      }).eq('id', listingId);
      // Re-hero with the rotating pool so store cards don't repeat photos either.
      await attachPhotos(listingId, category, 3);
      bump('store_listings');
      sc++;
    }
  }

  // 6b. Give every remaining test-persona store (e.g. the per-profile
  //     "Min Strikkebutikk" stores from seedProfile) a logo + banner so no store
  //     card renders imageless.
  const personaIds = Object.keys(PERSONA_META).map(id).filter((x): x is string => !!x);
  const { data: barelStores } = await db.from('stores')
    .select('id, created_by').in('created_by', personaIds).is('logo_path', null);
  for (const [i, st] of (barelStores ?? []).entries()) {
    await db.from('stores').update({
      logo_path: STORE_LOGO_SAMPLES[i % STORE_LOGO_SAMPLES.length],
      banner_path: STORE_BANNER_SAMPLES[i % STORE_BANNER_SAMPLES.length],
    }).eq('id', st.id);
    bump('stores_enriched');
  }

  // ── 7. Notifications of every remaining type for Liv, so /notifications is a
  //     full showcase (seed-world already produced message/dispute/follow ones).
  const livId = id(`liv${D}`)!;
  const sellerActor = elineId;
  const notifTypes: { type: NotifType; title: string; body: string; read?: boolean }[] = [
    { type: 'listing_purchased', title: 'Kjøpet er bekreftet', body: 'Betalingen for «Strikket genser» er mottatt.', read: true },
    { type: 'listing_shipped', title: 'Varen er sendt', body: 'Selger har sendt «Strikket genser». Sporing: POSTEN-100200.' },
    { type: 'listing_delivered', title: 'Levering bekreftet', body: 'Du bekreftet mottak. Beløpet frigis til selger.' , read: true },
    { type: 'listing_reservation_released', title: 'Reservasjon opphevet', body: 'Selger rakk ikke å sende i tide. Annonsen er lagt ut på nytt.' },
    { type: 'review_received', title: 'Ny vurdering', body: 'Du fikk terningkast 5 av en selger.' },
    { type: 'seller_activated', title: 'Du er nå selger', body: 'Utbetalingskontoen din er verifisert. Lykke til med salget!' },
    { type: 'achievement_unlocked', title: 'Nytt merke', body: 'Du låste opp «Første kjøp».', read: true },
    { type: 'pattern_purchased', title: 'Oppskrift kjøpt', body: 'Takk for kjøpet! «Solskinn» ligger klar under Mine oppskrifter.' },
    { type: 'commission_delivered', title: 'Oppdrag levert', body: 'Strikkeren har levert oppdraget ditt.' },
    { type: 'request_expired', title: 'Forespørsel utløpt', body: 'Oppdraget ditt fikk ingen tilbud og er utløpt.', read: true },
    { type: 'payment_failed', title: 'Betaling mislyktes', body: 'Betalingen ble avvist. Prøv et annet kort.' },
    { type: 'system_alert', title: 'Driftsmelding', body: 'Torget har fått nye leveringsvalg. Se innstillinger.' , read: true },
    { type: 'role_changed', title: 'Rollen din er endret', body: 'Du har fått moderatortilgang.' },
  ];
  // cleanup wipes Liv's notifications each run, so plain inserts stay idempotent.
  for (const n of notifTypes) {
    await db.from('notifications').insert({
      user_id: livId, type: n.type, title: n.title, body: n.body,
      url: '/notifications', actor_id: sellerActor,
      read_at: n.read ? new Date().toISOString() : null,
    });
    bump('notif_types');
  }

  // ── 8. Dead-letter events (ops/trust review). Tagged {seed:true} so they're
  //     idempotently removed on re-run (cleanup doesn't scope these by user).
  await db.from('dead_letter_events').delete().contains('context', { seed: true });
  const deadLetters = [
    {
      service: 'commissions.releaseCommissionFunds',
      user_id: id(`ingrid${D}`) ?? null,
      error: 'Stripe transfer failed: insufficient available balance (sim).',
      context: { seed: true, request_id: 'sim', amount_nok: 1400 },
      resolved: false,
    },
    {
      service: 'listings.completeListingPurchase',
      user_id: id(`liv${D}`) ?? null,
      error: 'Order insert conflict on payment_intent (sim, retried).',
      context: { seed: true, listing_title: 'Strikket lue' },
      resolved: true,
    },
  ];
  for (const dl of deadLetters) {
    await db.from('dead_letter_events').insert({
      service: dl.service, user_id: dl.user_id, error: dl.error, context: dl.context,
      resolved_at: dl.resolved ? new Date().toISOString() : null,
      resolved_by: dl.resolved ? (id(`silje${D}`) ?? null) : null,
      resolution_note: dl.resolved ? 'Håndtert manuelt av support (seed).' : null,
    });
    bump('dead_letters');
  }

  return counts;
}
