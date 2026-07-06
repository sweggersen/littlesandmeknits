// Dev-only: fill ONE user's profile dashboard (/profile and its variants) with a
// rich, realistic spread across every section — listings, projects, commission
// requests + offers (both directions), pattern purchases, a store, library
// items, an unread message, and badges. Used to review the profile-page design
// variants against non-empty data. Never runs in production.
//
// Each section is independent (try/catch) so a single failure doesn't abort the
// rest; the returned summary counts what landed.

import type { createAdminSupabase } from '../supabase';

type Db = ReturnType<typeof createAdminSupabase>;

interface Deps {
  db: Db;
  userId: string;
  /** Optional: attach placeholder photos to a listing (test-exec passes its own). */
  genListingPhotos?: (listingId: string, category: string, count: number) => Promise<void>;
}

const MATE_EMAIL = 'profilemate@test.strikketorget.no';

async function ensureMate(db: Db): Promise<string> {
  const { data: created, error } = await db.auth.admin.createUser({
    email: MATE_EMAIL, email_confirm: true, user_metadata: { display_name: 'Kari Medstrikker' },
  });
  if (created?.user) {
    await db.from('profiles').upsert(
      { id: created.user.id, display_name: 'Kari Medstrikker', location: 'Bergen' },
      { onConflict: 'id' },
    );
    return created.user.id;
  }
  // Already exists → look it up.
  if (error) {
    const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === MATE_EMAIL);
    if (existing) return existing.id;
  }
  throw new Error(`Could not ensure mate persona: ${error?.message}`);
}

export async function seedProfile({ db, userId, genListingPhotos }: Deps): Promise<Record<string, number>> {
  const target = userId;
  const summary: Record<string, number> = {};
  const bump = (k: string, n = 1) => { summary[k] = (summary[k] ?? 0) + n; };
  const now = () => new Date().toISOString();

  const mateId = await ensureMate(db);

  // 1. Listings (target is the seller) — a spread of kinds + statuses.
  const listingSpecs = [
    { title: 'Babygenser i merinoull', category: 'genser', kind: 'ready_made', price: 549, status: 'active', size: '1-2 år' },
    { title: 'Strikket lue, lite brukt', category: 'lue', kind: 'pre_loved', price: 149, status: 'active', size: '1-2 år' },
    { title: 'Kabelkofte, håndlaget', category: 'cardigan', kind: 'ready_made', price: 890, status: 'draft', size: '2 år' },
    { title: 'Babysokker (solgt)', category: 'sokker', kind: 'pre_loved', price: 99, status: 'sold', size: '0-6 mnd' },
  ] as const;
  const listingIds: string[] = [];
  for (const s of listingSpecs) {
    try {
      const { data: l, error } = await db.from('listings').insert({
        seller_id: target, kind: s.kind, title: s.title, category: s.category,
        size_label: s.size, price_nok: s.price,
        condition: s.kind === 'ready_made' ? null : 'lite_brukt',
        description: 'Testdata for profilsiden.', status: s.status, escrow_enabled: true,
      }).select('id').single();
      if (error || !l) continue;
      listingIds.push(l.id);
      if (genListingPhotos) { try { await genListingPhotos(l.id, s.category, 2); } catch { /* photos optional */ } }
      bump('listings');
    } catch { /* section-resilient */ }
  }

  // 2. Projects (Strikkestua).
  const projSpecs = [
    { title: 'Marius-genser til Emma', status: 'active', current: 120, target: 300 },
    { title: 'Sjal i alpakka', status: 'planning', current: null, target: null },
    { title: 'Babyteppe (ferdig)', status: 'finished', current: 280, target: 280 },
  ] as const;
  for (const pr of projSpecs) {
    try {
      await db.from('projects').insert({
        user_id: target, title: pr.title, status: pr.status,
        current_rows: pr.current, target_rows: pr.target,
        started_at: pr.status !== 'planning' ? now() : null,
        finished_at: pr.status === 'finished' ? now() : null,
      });
      bump('projects');
    } catch { /* */ }
  }

  // 3. Library (external patterns).
  for (const b of [
    { title: 'Sunday Sweater', designer: 'PetiteKnit' },
    { title: 'Nalle-genser', designer: 'Novita' },
  ]) {
    try {
      await db.from('external_patterns').insert({
        user_id: target, title: b.title, designer: b.designer,
        file_path: `library/${crypto.randomUUID()}.pdf`,
      });
      bump('bibliotek');
    } catch { /* */ }
  }

  // 4. Purchased patterns (mirrors the Stripe-webhook purchase row). Use REAL
  // pattern slugs (src/content/patterns/*) so the purchases page resolves the
  // title instead of falling back to the raw slug.
  for (const slug of ['solskinn', 'skog']) {
    try {
      await db.from('purchases').upsert({
        user_id: target, pattern_slug: slug, stripe_session_id: `sim_${slug}_${target}`,
        amount_nok: 89, currency: 'NOK', status: 'completed',
        pdf_path: `${slug}/v1.pdf`, fulfilled_at: now(),
      }, { onConflict: 'stripe_session_id' });
      bump('purchases');
    } catch { /* */ }
  }

  // 5. A store the target owns.
  try {
    const slug = `profilbutikk-${target.slice(0, 8)}`;
    const { data: existing } = await db.from('stores').select('id').eq('slug', slug).maybeSingle();
    if (!existing) {
      const { data: store } = await db.from('stores').insert({
        slug, orgnr: String(910000000 + Math.floor(Math.random() * 89999999)), created_by: target,
        legal_name: 'MIN STRIKKEBUTIKK AS', legal_address: 'Storgata 1, 0123 Oslo',
        legal_business_type: 'AS', legal_status: 'aktiv', name: 'Min Strikkebutikk',
        tagline: 'Håndlagde plagg.', location_city: 'Oslo', contact_email: 'hei@minbutikk.no', status: 'active',
      }).select('id').single();
      if (store) {
        await db.from('store_members').insert({ store_id: store.id, user_id: target, role: 'owner', visible_on_storefront: true });
        bump('stores');
      }
    }
  } catch { /* */ }

  // 6. Commission request the target posted (as buyer) + an offer from the mate.
  try {
    const { data: req } = await db.from('commission_requests').insert({
      buyer_id: target, title: 'Ønsker strikket dåpskjole', category: 'kjole', size_label: '0-3 mnd',
      budget_nok_min: 1200, budget_nok_max: 2200, description: 'Testdata.',
      yarn_provided_by_buyer: false, status: 'open', offer_count: 1,
    }).select('id').single();
    if (req) {
      bump('requests');
      await db.from('commission_offers').insert({
        request_id: req.id, knitter_id: mateId, price_nok: 1800, turnaround_weeks: 5,
        message: 'Jeg kan lage denne dåpskjolen!', status: 'pending',
      });
      bump('offers_received');
    }
  } catch { /* */ }

  // 7. Commission offer the target made (as knitter) on the mate's request.
  try {
    const { data: mreq } = await db.from('commission_requests').insert({
      buyer_id: mateId, title: 'Strikket genser til bursdag', category: 'genser', size_label: '3 år',
      budget_nok_min: 900, budget_nok_max: 1600, description: 'Testdata.',
      yarn_provided_by_buyer: false, status: 'open', offer_count: 1,
    }).select('id').single();
    if (mreq) {
      await db.from('commission_offers').insert({
        request_id: mreq.id, knitter_id: target, price_nok: 1400, turnaround_weeks: 4,
        message: 'Kan strikke denne for deg.', status: 'pending',
      });
      bump('offers_made');
    }
  } catch { /* */ }

  // 8. An unread message on one of the target's listings (mate -> target).
  try {
    if (listingIds.length) {
      const { data: conv } = await db.from('marketplace_conversations').insert({
        listing_id: listingIds[0], buyer_id: mateId, seller_id: target,
      }).select('id').single();
      if (conv) {
        await db.from('marketplace_messages').insert({
          conversation_id: conv.id, sender_id: mateId, body: 'Hei! Er denne fortsatt ledig?',
        });
        bump('unread_messages');
      }
    }
  } catch { /* */ }

  // 9. A handful of badges.
  for (const key of ['first_avatar', 'bio_written', 'first_project', 'first_log', 'project_finished']) {
    try { await db.from('user_achievements').insert({ user_id: target, achievement_key: key }); bump('badges'); }
    catch { /* likely already earned */ }
  }

  return summary;
}
