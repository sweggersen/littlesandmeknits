// Dev world-seeder: fills an empty database with a realistic, internally
// consistent Strikketorget — users, listings (new + used) in every status,
// knitting requests at every lifecycle stage, reviews, messages, disputes,
// refunds, moderation (approvals + rejections), reports across all target
// types (resolved and open), follows, and moderator payouts.
//
// It drives the SAME real-service code paths the e2e tests use (via test-exec's
// `handle()` switch), so a successful run is itself a proof that data can be
// injected correctly end-to-end; any broken flow throws with its step label.
//
// Invoked by the `seed-world` action in src/pages/api/dev/test-exec.ts. Dev-only.

import type { createAdminSupabase } from '../supabase';

type Db = ReturnType<typeof createAdminSupabase>;
type Handle = (db: Db, action: string, actorId: string | null, p: Record<string, unknown>, emailToId: Map<string, string>) => Promise<{ data?: unknown }>;

const D = '@test.strikketorget.no';
// Cast of characters (kebab locals keep them distinct from ad-hoc test users).
const U = {
  eline: `eline${D}`,      // trusted seller + store owner + knitter
  maja: `maja${D}`,        // new seller (listings route to moderation)
  liv: `liv${D}`,          // buyer
  kari: `kari${D}`,        // buyer
  nora: `nora${D}`,        // buyer
  ingrid: `ingrid${D}`,    // knitter
  solveig: `solveig${D}`,  // knitter
  hanne: `hanne${D}`,      // moderator (queue + reports)
  silje: `silje${D}`,      // admin (dispute resolution)
} as const;
const NAMES: Record<string, string> = {
  [U.eline]: 'Eline Berg', [U.maja]: 'Maja Lund', [U.liv]: 'Liv Johansen',
  [U.kari]: 'Kari Ness', [U.nora]: 'Nora Dahl', [U.ingrid]: 'Ingrid Moen',
  [U.solveig]: 'Solveig Vik', [U.hanne]: 'Hanne Aas', [U.silje]: 'Silje Admin',
};

export async function seedWorld(deps: { db: Db; handle: Handle; emailToId: Map<string, string> }): Promise<Record<string, number>> {
  const { db, handle, emailToId } = deps;
  const counts: Record<string, number> = {};
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };

  async function ensure(email: string): Promise<string> {
    let id = emailToId.get(email);
    if (!id) {
      // GoTrue can be cold right after `supabase db reset` and return an empty
      // error on the first createUser; retry a few times before giving up.
      let lastErr = 'unknown';
      for (let attempt = 0; attempt < 5 && !id; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
        const { data: created, error } = await db.auth.admin.createUser({
          email, email_confirm: true, user_metadata: { display_name: NAMES[email] ?? email },
        });
        if (created?.user) { id = created.user.id; break; }
        lastErr = error?.message || JSON.stringify(error ?? {});
      }
      if (!id) throw new Error(`create user ${email} after retries: ${lastErr}`);
      emailToId.set(email, id);
    }
    await db.from('profiles').upsert({ id, display_name: NAMES[email] ?? email }, { onConflict: 'id' });
    return id;
  }

  /** Run a test-exec action through the real handler, labelled for errors. */
  async function run(action: string, actorEmail: string | null, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const actorId = actorEmail ? emailToId.get(actorEmail) ?? null : null;
    if (actorEmail && !actorId) throw new Error(`run(${action}): unknown actor ${actorEmail}`);
    try {
      const res = await handle(db, action, actorId, params, emailToId);
      return (res?.data ?? {}) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`seed step "${action}" as ${actorEmail ?? 'system'} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const id = (email: string) => emailToId.get(email)!;

  // ── 0. Fresh slate + cast ────────────────────────────────────────────────
  for (const email of Object.values(U)) await ensure(email);
  await handle(db, 'cleanup', null, {}, emailToId);
  // cleanup wipes seller_profiles etc.; re-establish profiles after.
  for (const email of Object.values(U)) await ensure(email);

  // Roles / capabilities
  await run('set-trust', U.eline, { trust_tier: 'trusted', trust_score: 100 });
  await run('set-trust', U.ingrid, { trust_tier: 'trusted', trust_score: 90 });
  for (const s of [U.eline, U.ingrid, U.solveig]) await run('set-stripe-onboarded', s);
  for (const u of Object.values(U)) await run('set-profile-visible', u);
  // Moderator: senior (>=50 reviews => non-shadow, decisions take effect).
  await db.from('profiles').update({ role: 'moderator' }).eq('id', id(U.hanne));
  await run('set-mod-stats', U.hanne, { total_reviews: 60, current_month_reviews: 0, current_month_earned_nok: 0 });
  // Admin: resolves disputes (admin-only in the service layer).
  await db.from('profiles').update({ role: 'admin' }).eq('id', id(U.silje));

  // ── 1. Listings (new + used) ─────────────────────────────────────────────
  // Photos are flat-colour placeholders; `npm run seed:photos` swaps in real
  // category-matched knitwear photos from Wikimedia Commons.
  async function listing(seller: string, o: { title: string; kind: string; category: string; size: string; price: number; condition?: string; photos?: number; publish?: boolean }): Promise<string> {
    const data = await run('create-listing', seller, {
      title: o.title, kind: o.kind, category: o.category, size_label: o.size,
      price_nok: o.price, condition: o.kind === 'ready_made' ? null : (o.condition ?? 'lite_brukt'),
      escrow_enabled: true, photo_count: o.photos ?? 2,
    });
    bump('listings');
    if (o.publish !== false) await run('publish-listing', null, { listing_id: data.id });
    return data.id as string;
  }

  // Publish ALL of Eline's listings FIRST, while she's trusted. Completing a
  // sale recomputes a fresh seller's trust downward (trust is earned), which
  // would route any LATER publish to moderation — so create/publish everything
  // up front, then run the transaction flows below.
  const lGenser = await listing(U.eline, { title: 'Strikket genser i merinoull', kind: 'pre_loved', category: 'genser', size: '2 år', price: 349, photos: 3 });
  const lLue = await listing(U.eline, { title: 'Nystrikket lue i alpakka', kind: 'ready_made', category: 'lue', size: '1-2 år', price: 199 });
  await listing(U.eline, { title: 'Babyvotter i myk ull', kind: 'pre_loved', category: 'votter', size: '0-6 mnd', price: 129 });
  await listing(U.eline, { title: 'Håndstrikket babyteppe', kind: 'ready_made', category: 'teppe', size: 'One size', price: 549, photos: 3 });
  await listing(U.eline, { title: 'Strikket skjerf i bomull', kind: 'pre_loved', category: 'annet', size: 'One size', price: 99 });
  await listing(U.eline, { title: 'Strikkebukse, str 4 år', kind: 'ready_made', category: 'bukser', size: '4 år', price: 259 });
  const lReported = await listing(U.eline, { title: 'Strikket kjole, festklar', kind: 'pre_loved', category: 'kjole', size: '3 år', price: 399 });
  const lSold = await listing(U.eline, { title: 'Kabelstrikket cardigan', kind: 'pre_loved', category: 'cardigan', size: '2 år', price: 449 });
  const lReserved = await listing(U.eline, { title: 'Strikkede sokker i ullmix', kind: 'pre_loved', category: 'sokker', size: '1 år', price: 149 });
  const lDisputed = await listing(U.eline, { title: 'Strikket topp, str 5 år', kind: 'pre_loved', category: 'genser', size: '5 år', price: 199 });
  const lRefundOk = await listing(U.eline, { title: 'Strikket jakke, str 3 år', kind: 'pre_loved', category: 'cardigan', size: '3 år', price: 379 });
  const lRefundNo = await listing(U.eline, { title: 'Strikket lue med dusk', kind: 'ready_made', category: 'lue', size: '2-4 år', price: 179 });
  await listing(U.eline, { title: 'Utkast: strikket bunad-inspirert kofte', kind: 'pre_loved', category: 'cardigan', size: '6 år', price: 899, publish: false });
  bump('drafts');

  // Transaction flows on the now-active listings.
  // Sold (full happy path + review)
  await run('purchase-listing', U.liv, { listing_id: lSold, buyer_name: 'Liv Johansen', buyer_address: 'Storgata 12', buyer_postal_code: '0155', buyer_city: 'Oslo' });
  await run('ship-listing', U.eline, { listing_id: lSold, tracking_code: 'POSTEN-100200' });
  await run('confirm-listing-delivery', U.liv, { listing_id: lSold });
  await run('submit-seller-review', U.liv, { listing_id: lSold, rating: 5, comment: 'Nydelig kvalitet og rask levering. Anbefales!' });
  bump('reviews'); bump('sold');

  // Reserved (awaiting shipping)
  await run('purchase-listing', U.kari, { listing_id: lReserved, buyer_name: 'Kari Ness', buyer_address: 'Bjørnstjerne Bjørnsons gate 4', buyer_postal_code: '7014', buyer_city: 'Trondheim' });
  bump('reserved');

  // Disputed -> resolved (funds released to seller)
  await run('purchase-listing', U.nora, { listing_id: lDisputed, buyer_name: 'Nora Dahl', buyer_address: 'Kongens gate 8', buyer_postal_code: '5003', buyer_city: 'Bergen' });
  await run('ship-listing', U.eline, { listing_id: lDisputed, tracking_code: 'POSTEN-100300' });
  await run('dispute-listing', U.nora, { listing_id: lDisputed, reason: 'Fargen var mørkere enn på bildet.' });
  await run('resolve-dispute', U.silje, { item_type: 'listing', item_id: lDisputed, decision: 'release', notes: 'Varen er som beskrevet, mindre fargeavvik. Frigis til selger.' });
  bump('disputes');

  // Refund accepted + refund rejected
  await run('purchase-listing', U.kari, { listing_id: lRefundOk, buyer_name: 'Kari Ness', buyer_address: 'Bjørnstjerne Bjørnsons gate 4', buyer_postal_code: '7014', buyer_city: 'Trondheim' });
  await run('request-refund', U.kari, { listing_id: lRefundOk, reason: 'not_as_described', description: 'Passet dessverre ikke.' });
  await run('respond-refund', U.eline, { listing_id: lRefundOk, refund_action: 'accept', notes: 'Helt greit, refunderer.' });
  bump('refunds');

  await run('purchase-listing', U.liv, { listing_id: lRefundNo, buyer_name: 'Liv Johansen', buyer_address: 'Storgata 12', buyer_postal_code: '0155', buyer_city: 'Oslo' });
  await run('request-refund', U.liv, { listing_id: lRefundNo, reason: 'not_as_described', description: 'Passer ikke, ønsker refusjon.' });
  // decline escalates to a formal dispute (seller contests) — leaves an open
  // dispute for the admin queue.
  await run('respond-refund', U.eline, { listing_id: lRefundNo, refund_action: 'decline', notes: 'Varen er som beskrevet, avviser refusjon.' });
  bump('refunds'); bump('disputes');

  // ── 2. Moderated listings (Maja is new -> pending_review) ────────────────
  const modApprove = await run('create-listing-moderated', U.maja, { title: 'Strikket genser, håndlaget', category: 'genser', size_label: '3 år', price_nok: 329, photo_count: 2 });
  bump('listings');
  await run('moderate-review', U.hanne, { queue_item_id: modApprove.queue_item_id, decision: 'approve', internal_notes: 'Ser fint ut.' });
  bump('moderation');

  const modReject = await run('create-listing-moderated', U.maja, { title: 'Billige klær selges billig!!!', category: 'bukser', size_label: '4 år', price_nok: 49, photo_count: 1 });
  bump('listings');
  await run('moderate-review', U.hanne, { queue_item_id: modReject.queue_item_id, decision: 'reject', rejection_reason: 'Mistenkelig annonse / mulig spam.', internal_notes: 'Avvist.' });
  bump('moderation');

  // ── 3. A store with one listing ──────────────────────────────────────────
  const store = await run('seed-store', U.eline, { slug: 'elines-strikk', name: 'Elines Strikk' });
  bump('stores');
  await db.from('listings').update({ store_id: store.storeId as string }).eq('id', lLue);

  // ── 4. Knitting requests at every lifecycle stage ────────────────────────
  async function request(buyer: string, o: { title: string; category: string; size: string; min: number; max: number; yarn?: boolean }): Promise<string> {
    const data = await run('create-request', buyer, {
      title: o.title, category: o.category, size_label: o.size,
      budget_nok_min: o.min, budget_nok_max: o.max, yarn_provided_by_buyer: !!o.yarn,
    });
    bump('requests');
    return data.id as string;
  }
  const offer = async (knitter: string, requestId: string, price: number, weeks: number, msg: string): Promise<string> => {
    const data = await run('make-offer', knitter, { request_id: requestId, price_nok: price, turnaround_weeks: weeks, message: msg });
    bump('offers');
    return data.offerId as string;
  };

  // (a) open, no offers
  await request(U.liv, { title: 'Ønsker strikket genser i rosa', category: 'genser', size: '2 år', min: 800, max: 1400 });

  // (b) open, with two competing offers
  const rB = await request(U.kari, { title: 'Kabelkofte til dåp', category: 'cardigan', size: '0-3 mnd', min: 1200, max: 2200 });
  await offer(U.ingrid, rB, 1800, 4, 'Jeg strikker gjerne en klassisk dåpskofte.');
  await offer(U.solveig, rB, 1600, 5, 'Kan lage denne i økologisk merino.');

  // (c) awaiting_payment (offer accepted, not paid)
  const rC = await request(U.nora, { title: 'Strikket kjole til bursdag', category: 'kjole', size: '3 år', min: 900, max: 1600 });
  const oC = await offer(U.ingrid, rC, 1400, 3, 'Jeg kan strikke en fin bursdagskjole.');
  await run('accept-offer', U.nora, { offer_id: oC });

  // (d) awarded / in progress (no buyer yarn)
  const rD = await request(U.liv, { title: 'Strikket lue og votter-sett', category: 'lue', size: '1 år', min: 500, max: 900 });
  const oD = await offer(U.ingrid, rD, 750, 2, 'Sett med lue og votter, ja takk!');
  await run('accept-offer', U.liv, { offer_id: oD });
  await run('pay', U.liv, { request_id: rD });
  // Knitter posts an optional mid-commission progress update (P2.1).
  await run('add-progress-log', U.ingrid, { request_id: rD, body: 'God start! Luen er ferdig, votter på pinnene nå.' });

  // Proven-knitter history: buyer-yarn requests (below) are gated on the
  // knitter having >= 1 delivered commission (P0.3). Backfill that history for
  // the two knitters who take eget-garn offers.
  await run('seed-proven-knitter', U.solveig, { buyer_email: `liv${D}` });
  await run('seed-proven-knitter', U.ingrid, { buyer_email: `liv${D}` });

  // (e) awaiting_yarn (buyer provides yarn, paid)
  const rE = await request(U.kari, { title: 'Strikket teppe, mitt eget garn', category: 'teppe', size: 'One size', min: 700, max: 1200, yarn: true });
  const oE = await offer(U.solveig, rE, 1000, 6, 'Kan strikke teppe av ditt garn.');
  await run('accept-offer', U.kari, { offer_id: oE });
  await run('pay', U.kari, { request_id: rE });

  // (f) in progress after buyer yarn shipped + received
  const rF = await request(U.nora, { title: 'Strikkejakke av arvegarn', category: 'cardigan', size: '4 år', min: 1000, max: 1800, yarn: true });
  const oF = await offer(U.ingrid, rF, 1500, 5, 'Jeg tar godt vare på arvegarnet.');
  await run('accept-offer', U.nora, { offer_id: oF });
  await run('pay', U.nora, { request_id: rF });
  await run('ship-yarn', U.nora, { request_id: rF, tracking_code: 'POSTEN-YARN-01' });
  await run('receive-yarn', U.ingrid, { request_id: rF });

  // (g) completed (knitter done, awaiting buyer confirmation)
  const rG = await request(U.liv, { title: 'Strikkede babysokker', category: 'sokker', size: '0-6 mnd', min: 400, max: 700 });
  const oG = await offer(U.solveig, rG, 550, 2, 'Søte babysokker på vei!');
  await run('accept-offer', U.liv, { offer_id: oG });
  await run('pay', U.liv, { request_id: rG });
  await run('mark-completed', U.solveig, { request_id: rG, tracking_code: 'POSTEN-COMM-07' });

  // (h) delivered + reviewed (full lifecycle)
  const rH = await request(U.kari, { title: 'Strikket genser med mønster', category: 'genser', size: '2 år', min: 900, max: 1500 });
  const oH = await offer(U.ingrid, rH, 1200, 3, 'Mønsterstrikk er min spesialitet.');
  await run('accept-offer', U.kari, { offer_id: oH });
  await run('pay', U.kari, { request_id: rH });
  await run('mark-completed', U.ingrid, { request_id: rH, tracking_code: 'POSTEN-COMM-08' });
  await run('confirm-delivery', U.kari, { request_id: rH });
  await run('submit-tx-review', U.kari, { commission_request_id: rH, rating: 5, comment: 'Utrolig fin genser, akkurat som avtalt!' });
  bump('reviews'); bump('completed');

  // (i) cancelled
  const rI = await request(U.nora, { title: 'Strikket pledd (avbestilt)', category: 'teppe', size: 'One size', min: 600, max: 1000 });
  await db.from('commission_requests').update({ status: 'cancelled' }).eq('id', rI);
  bump('cancelled');

  // (j) moderated request -> approved, (k) -> rejected
  const rJ = await run('create-request-moderated', U.liv, { title: 'Strikket adventskalender-sokker', category: 'sokker', size: 'One size', budget_nok_min: 800, budget_nok_max: 1600 });
  bump('requests');
  await run('moderate-review', U.hanne, { queue_item_id: rJ.queue_item_id, decision: 'approve', internal_notes: 'Grei forespørsel.' });
  bump('moderation');
  const rK = await run('create-request-moderated', U.maja, { title: 'GRATIS strikk?? ring meg', category: 'annet', size_label: 'One size', budget_nok_min: 0, budget_nok_max: 10 });
  bump('requests');
  await run('moderate-review', U.hanne, { queue_item_id: rK.queue_item_id, decision: 'reject', rejection_reason: 'Spam / ikke reelt oppdrag.' });
  bump('moderation');

  // ── 5. Messages (buyer <-> seller on listings) ───────────────────────────
  await run('send-message', U.liv, { listing_id: lGenser, message: 'Hei! Er denne fortsatt ledig? Kan du sende til Oslo?' });
  await run('send-message', U.kari, { listing_id: lReported, message: 'Så fin! Hvor lang er kjolen fra skulder til kant?' });
  bump('messages'); bump('messages');

  // ── 6. Follows ───────────────────────────────────────────────────────────
  for (const follower of [U.liv, U.kari, U.nora]) {
    await db.from('seller_follows').upsert({ follower_id: id(follower), seller_id: id(U.eline) }, { onConflict: 'follower_id,seller_id' });
    bump('follows');
  }
  await db.from('seller_follows').upsert({ follower_id: id(U.kari), seller_id: id(U.ingrid) }, { onConflict: 'follower_id,seller_id' });
  bump('follows');

  // ── 7. Reports across all target types (resolved + open) ─────────────────
  const report = async (reporter: string, targetType: string, targetId: string, reason: string, description: string): Promise<string> => {
    const data = await run('submit-report', reporter, { target_type: targetType, target_id: targetId, reason, description });
    bump('reports');
    return data.id as string;
  };
  const rep1 = await report(U.liv, 'listing', lReported, 'scam', 'Ser ut som en kopi av en kjent annonse.');
  await run('resolve-report', U.hanne, { report_id: rep1, notes: 'Sjekket, alt i orden.' });
  await report(U.kari, 'listing', lGenser, 'inappropriate', 'Beskrivelsen virker misvisende.'); // left OPEN (follow-up)
  const rep3 = await report(U.nora, 'commission_request', rB, 'spam', 'Virker som spam.');
  await run('resolve-report', U.hanne, { report_id: rep3, dismiss: true, notes: 'Reell forespørsel, avvist rapport.' });
  const rep4 = await report(U.liv, 'profile', id(U.maja), 'other', 'Selger svarer ikke på meldinger.');
  await run('resolve-report', U.hanne, { report_id: rep4, notes: 'Kontaktet selger.' });
  await report(U.nora, 'listing', lLue, 'wrong_category', 'Burde ligge under tilbehør.'); // left OPEN

  // ── 8. Moderator payouts (from Hanne's decisions this month) ─────────────
  const payout = await run('generate-payouts', U.hanne, {});
  if ((payout.count as number) > 0) bump('payouts');

  return counts;
}
