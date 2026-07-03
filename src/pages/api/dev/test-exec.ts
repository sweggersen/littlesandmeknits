import type { APIRoute } from 'astro';
import { env } from '../../../lib/env';
import { getCurrentUser } from '../../../lib/auth';
import { createAdminSupabase } from '../../../lib/supabase';
import { devToolsBlocked } from '../../../lib/dev-guard';
import type { ServiceContext } from '../../../lib/services/types';
import {
  createRequest as svcCreateRequest,
  makeOffer as svcMakeOffer,
  acceptOffer as svcAcceptOffer,
  payCommission as svcPayCommission,
  markCompleted as svcMarkCompleted,
  confirmDelivery as svcConfirmDelivery,
  shipYarn as svcShipYarn,
  receiveYarn as svcReceiveYarn,
  finalizeCommissionPayment as svcFinalizeCommissionPayment,
} from '../../../lib/services/commissions';
import {
  publishListing as svcPublishListing,
  shipListing as svcShipListing,
  confirmListingDelivery as svcConfirmListingDelivery,
  completeListingPurchase as svcCompleteListingPurchase,
  disputeListing as svcDisputeListing,
  releaseExpiredReservation as svcReleaseExpiredReservation,
} from '../../../lib/services/listings';
import { submitSellerReview as svcSubmitSellerReview } from '../../../lib/services/seller-reviews';
import { requestRefund as svcRequestRefund, respondToRefund as svcRespondToRefund } from '../../../lib/services/refunds';
import { resolveDispute as svcResolveDispute } from '../../../lib/services/disputes';
import { handleChargebackOpened, handleChargebackClosed } from '../../../lib/services/stripe-events';

/** Test-only synthetic ctx: the admin client backs both `supabase` and
 *  `admin` slots, so services can do their work without RLS getting
 *  in the way. RLS is exercised by the dedicated rls.spec.ts suite,
 *  not by test-exec — these are flow fixtures, not policy tests. */
function synthCtx(
  db: ReturnType<typeof createAdminSupabase>,
  actorId: string,
  actorEmail?: string,
): ServiceContext {
  return {
    supabase: db,
    admin: db,
    user: { id: actorId, email: actorEmail ?? undefined },
    env: env as unknown as Record<string, string>,
  };
}

const ADMINS = ['ammon.weggersen@gmail.com', 'sam.mathias.weggersen@gmail.com'];

async function makeTestPng(hexColor: string, size = 200): Promise<Uint8Array> {
  const r = parseInt(hexColor.slice(0, 2), 16);
  const g = parseInt(hexColor.slice(2, 4), 16);
  const b = parseInt(hexColor.slice(4, 6), 16);

  const rowLen = 1 + size * 3;
  const raw = new Uint8Array(rowLen * size);
  for (let y = 0; y < size; y++) {
    const off = y * rowLen;
    raw[off] = 0;
    for (let x = 0; x < size; x++) {
      raw[off + 1 + x * 3] = r;
      raw[off + 2 + x * 3] = g;
      raw[off + 3 + x * 3] = b;
    }
  }

  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(raw);
  writer.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());

  const u32 = (n: number) => new Uint8Array([(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  const crc32 = (buf: Uint8Array) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); }
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const t = new TextEncoder().encode(type);
    const payload = new Uint8Array(t.length + data.length);
    payload.set(t); payload.set(data, t.length);
    const out = new Uint8Array(4 + payload.length + 4);
    out.set(u32(data.length)); out.set(payload, 4); out.set(u32(crc32(payload)), 4 + payload.length);
    return out;
  };

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, size);
  new DataView(ihdr.buffer).setUint32(4, size);
  ihdr[8] = 8; ihdr[9] = 2;

  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { png.set(p, off); off += p.length; }
  return png;
}

const TEST_COLORS: Record<string, string[]> = {
  genser:    ['c9a9a6', 'a8c8a8', 'b8a9c9'],
  jakke:     ['d4b5a0', 'a0b8d4', 'c8b8a0'],
  bukse:     ['b0c4b0', 'c4b0b0', 'b0b0c4'],
  body:      ['f0d0d0', 'd0f0d0', 'd0d0f0'],
  lue:       ['e8c8a8', 'a8d8e8', 'c8a8e8'],
  sokker:    ['d0b8a0', 'a0c8b8', 'b8a0c8'],
  votter:    ['c8b0a0', 'a0b8c8', 'b0a0c8'],
  kjole:     ['e0c0d0', 'c0d0e0', 'd0e0c0'],
  skjørt:    ['d8c0b8', 'b8d0c8', 'c0b8d8'],
  accessory: ['d4c4b4', 'b4c4d4', 'c4d4b4'],
  annet:     ['c0c0c0', 'b0b0b0', 'd0d0d0'],
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyAdminToken(token: string): Promise<boolean> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(env.SUPABASE_SERVICE_ROLE_KEY);
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  for (const date of [now, yesterday]) {
    const day = date.toISOString().slice(0, 10);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`admin-tower-${day}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig))).slice(0, 43);
    if (token === expected) return true;
  }
  return false;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const blocked = devToolsBlocked(request);
  if (blocked) return blocked;

  const adminToken = request.headers.get('X-Admin-Token');
  if (adminToken) {
    if (!(await verifyAdminToken(adminToken))) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }
  } else {
    const user = await getCurrentUser({ request, cookies });
    if (!user || !ADMINS.includes(user.email ?? '')) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }
  }

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'Service role key not configured' }, 503);
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const { action, actor, params = {} } = await request.json();

  const { data: { users: allUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailToId = new Map<string, string>();
  for (const u of allUsers ?? []) {
    if (u.email?.endsWith('@test.strikketorget.no')) emailToId.set(u.email, u.id);
  }

  async function ensureTestUser(email: string) {
    if (!email.endsWith('@test.strikketorget.no') || emailToId.has(email)) return;
    const name = email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { display_name: name },
    });
    if (createErr) throw new Error(`Could not create test user ${email}: ${createErr.message}`);
    if (created.user) {
      emailToId.set(email, created.user.id);
      await admin.from('profiles').upsert({ id: created.user.id, display_name: name }, { onConflict: 'id' });
    }
  }

  if (actor) await ensureTestUser(actor);
  if (Array.isArray(params.user_emails)) {
    for (const email of params.user_emails) await ensureTestUser(email);
  }

  const actorId = actor ? emailToId.get(actor) ?? null : null;
  if (actor && !actorId) return json({ ok: false, error: `Unknown user: ${actor}` }, 400);

  try {
    const result = await handle(admin, action, actorId, params, emailToId);
    return json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('test-exec error:', msg);
    return json({ ok: false, error: msg }, 500);
  }
};

async function handle(
  db: ReturnType<typeof createAdminSupabase>,
  action: string,
  actorId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // The fixture input is shaped per-case at the call site (e.g. JSON
  // bodies posted from Playwright). Using `any` is the deliberate
  // choice here -- this is a dev/test endpoint, not user-facing code.
  p: any,
  emailToId: Map<string, string>,
) {
  switch (action) {
    // ── Commission flow ───────────────────────────────

    case 'create-request': {
      if (!actorId) throw new Error('Actor required');
      const { data, error } = await db.from('commission_requests').insert({
        buyer_id: actorId,
        title: p.title ?? 'Test-oppdrag',
        category: p.category ?? 'genser',
        size_label: p.size_label ?? '2 år',
        budget_nok_min: p.budget_nok_min ?? 800,
        budget_nok_max: p.budget_nok_max ?? 1500,
        description: p.description ?? 'Testoppdrag fra kontrollpanelet.',
        yarn_provided_by_buyer: p.yarn_provided_by_buyer ?? false,
        target_knitter_id: p.target_knitter_id ?? null,
        needed_by: p.needed_by ?? null,
        colorway: p.colorway ?? null,
        yarn_preference: p.yarn_preference ?? null,
        status: 'open',
        offer_count: 0,
      }).select().single();
      if (error) throw error;
      // Also expose under a uniquely-named binding so ui-flows can ref
      // $requestId without it getting overwritten by later apiCalls that
      // happen to return an `id` field.
      return { data: { ...data, requestId: data.id } };
    }

    case 'make-offer': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcMakeOffer(synthCtx(db, actorId), {
        requestId: p.request_id as string,
        priceNok: String(p.price_nok ?? 1200),
        turnaroundWeeks: String(p.turnaround_weeks ?? 3),
        message: (p.message as string) ?? 'Jeg kan strikke dette for deg!',
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      // Fetch the just-created offer so ui-flows can capture $offerId.
      const { data: offer } = await db.from('commission_offers')
        .select('id').eq('request_id', p.request_id).eq('knitter_id', actorId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      return { data: { id: offer?.id, offerId: offer?.id } };
    }

    case 'accept-first-offer': {
      // Convenience for ui-flows: when the buyer doesn't have a captured
      // $offerId (e.g. the offer was created via real UI form submit),
      // accept whichever pending offer exists on the request. Falls
      // through to accept-offer which calls the real service.
      if (!actorId) throw new Error('Actor required');
      const { data: pending } = await db.from('commission_offers')
        .select('id').eq('request_id', p.request_id).eq('status', 'pending')
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!pending) throw new Error('No pending offer found');
      p.offer_id = pending.id;
    }
    // eslint-disable-next-line no-fallthrough
    case 'accept-offer': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcAcceptOffer(synthCtx(db, actorId), { offerId: p.offer_id as string });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { data: { offerId: p.offer_id } };
    }

    case 'pay': {
      // Full commission payment as prod experiences it: payCommission creates
      // the Stripe checkout session (the awarded knitter must be Stripe-verified
      // — see set-stripe-onboarded), then we SIMULATE the
      // checkout.session.completed webhook by invoking the real
      // finalizeCommissionPayment. That flips status (awarded / awaiting_yarn),
      // activates the project, records platform_fee, and notifies — matching
      // the H2b separate-charges-&-transfers model.
      if (!actorId) throw new Error('Actor required');
      const result = await svcPayCommission(synthCtx(db, actorId), { requestId: p.request_id as string });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);

      const { data: offerRow } = await db.from('commission_requests')
        .select('awarded_offer_id, commission_offers!commission_requests_awarded_offer_fkey(price_nok)')
        .eq('id', p.request_id).single();
      const priceNok = (offerRow as any)?.commission_offers?.price_nok ?? 0;
      const fin = await svcFinalizeCommissionPayment(db, env as unknown as Record<string, string>, {
        requestId: p.request_id as string,
        paymentIntentId: 'pi_sim_comm_' + Date.now(),
        platformFeeOre: Math.round(priceNok * 100 * 0.12),
      });
      if (!fin.ok) throw new Error(`finalize: ${fin.code}: ${fin.message}`);

      const { data: req } = await db.from('commission_requests')
        .select('status, commission_offers!commission_requests_awarded_offer_fkey(project_id)')
        .eq('id', p.request_id).single();
      const projectId = (req as any)?.commission_offers?.project_id ?? null;
      const project = projectId
        ? (await db.from('projects').select('*').eq('id', projectId).maybeSingle()).data
        : null;
      return { data: { status: req?.status, project } };
    }

    case 'ship-yarn': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcShipYarn(synthCtx(db, actorId), {
        requestId: p.request_id as string,
        trackingCode: p.tracking_code as string | undefined,
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { data: { shipped: true } };
    }

    case 'receive-yarn': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcReceiveYarn(synthCtx(db, actorId), { requestId: p.request_id as string });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { data: { status: 'awarded' } };
    }

    case 'mark-completed': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcMarkCompleted(synthCtx(db, actorId), {
        requestId: p.request_id as string,
        trackingCode: (p.tracking_code as string | undefined),
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { data: { status: 'completed' } };
    }

    case 'confirm-delivery': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcConfirmDelivery(synthCtx(db, actorId), { requestId: p.request_id as string });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { data: { status: 'delivered' } };
    }

    // ── Listing purchase flow ────────────────────────

    case 'set-stripe-onboarded': {
      if (!actorId) throw new Error('Actor required');
      await db.from('seller_profiles').upsert({
        id: actorId,
        stripe_account_id: 'acct_test_' + actorId.slice(0, 8),
        stripe_connect_status: 'verified',
        seller_verified_at: new Date().toISOString(),
      });
      return { data: { user_id: actorId, stripe_connect_status: 'verified' } };
    }

    case 'purchase-listing': {
      if (!actorId) throw new Error('Actor required');
      const { data: listing } = await db.from('listings')
        .select('id, price_nok, shipping_price_nok')
        .eq('id', p.listing_id)
        .single();
      if (!listing) throw new Error('Listing not found');

      // Call the REAL webhook path so the sim exercises production escrow code:
      // inserts the order (money + shipping PII), flips the catalog projection,
      // and records the 'reserved' payment_events ledger row. amountTotalOre =
      // item + shipping + TB fee (what Stripe would charge); platformFeeOre =
      // the TB fee (H4 launch model: app fee = TB fee only).
      const { tbFeeForPrice } = await import('../../../lib/shipping');
      const tbFee = tbFeeForPrice(listing.price_nok);
      const shipNok = listing.shipping_price_nok ?? 0;
      const amountTotalOre = (listing.price_nok + shipNok + tbFee) * 100;
      const res = await svcCompleteListingPurchase(db, {
        listingId: p.listing_id as string,
        buyerId: actorId,
        paymentIntentId: 'pi_test_' + Date.now(),
        amountTotalOre,
        platformFeeOre: tbFee * 100,
        tbFeeNok: tbFee,
        shippingNok: shipNok,
        shipping: {
          name: (p.buyer_name as string) ?? null,
          line1: (p.buyer_address as string) ?? null,
          postalCode: (p.buyer_postal_code as string) ?? null,
          city: (p.buyer_city as string) ?? null,
        },
      });
      if (!res.updated) throw new Error(res.error ? String((res.error as { message?: string }).message ?? 'db error') : 'purchase did not transition (listing not active?)');
      return { data: { listing_id: p.listing_id, status: 'reserved' } };
    }

    case 'ship-listing': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcShipListing(synthCtx(db, actorId), {
        listingId: p.listing_id as string,
        trackingCode: (p.tracking_code as string | undefined) ?? 'TEST-TRACK-001',
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { data: { status: 'shipped' } };
    }

    case 'confirm-listing-delivery': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcConfirmListingDelivery(synthCtx(db, actorId), {
        listingId: p.listing_id as string,
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);

      return { data: { status: 'sold' } };
    }

    case 'request-refund': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcRequestRefund(synthCtx(db, actorId), {
        listingId: p.listing_id as string,
        reason: (p.reason as string) ?? 'not_as_described',
        description: p.description as string | undefined,
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { data: { requested: true } };
    }

    case 'respond-refund': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcRespondToRefund(synthCtx(db, actorId), {
        listingId: p.listing_id as string,
        action: (p.refund_action as string) ?? 'accept',
        notes: p.notes as string | undefined,
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { data: { responded: p.refund_action ?? 'accept' } };
    }

    case 'dispute-listing': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcDisputeListing(synthCtx(db, actorId), {
        listingId: p.listing_id as string,
        reason: (p.reason as string) ?? 'Varen kom aldri fram.',
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { data: { disputed: true } };
    }

    case 'resolve-dispute': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcResolveDispute(synthCtx(db, actorId), {
        itemType: (p.item_type as string) ?? 'listing',
        itemId: p.item_id as string,
        decision: (p.decision as string) ?? 'refund',
        notes: p.notes as string | undefined,
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { data: { resolved: p.decision ?? 'refund' } };
    }

    case 'release-reservation': {
      // Simulates the cron releasing an unshipped reservation whose ship-by
      // deadline passed (cancels the escrow hold, relists). System action.
      const res = await svcReleaseExpiredReservation(db, env as unknown as Parameters<typeof svcReleaseExpiredReservation>[1], {
        listingId: p.listing_id as string,
        reason: ((p.reason as string) ?? 'ship_deadline') as 'ship_deadline' | 'auth_canceled',
      });
      return { data: { released: res.released } };
    }

    case 'chargeback-open': {
      // Fabricate the Stripe dispute the webhook would receive for this order's PI.
      const { data: order } = await db.from('orders')
        .select('stripe_payment_intent_id').eq('listing_id', p.listing_id as string)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      const dispute = {
        id: 'dp_sim_' + Date.now(),
        payment_intent: order?.stripe_payment_intent_id,
        reason: (p.reason as string) ?? 'product_not_received',
        status: 'needs_response',
      };
      const resp = await handleChargebackOpened(db, dispute as never, env as never);
      return { data: { http: resp.status, dispute_id: dispute.id } };
    }

    case 'chargeback-close': {
      const dispute = { id: p.dispute_id, status: (p.outcome as string) ?? 'won' };
      const resp = await handleChargebackClosed(db, dispute as never, env as never);
      return { data: { http: resp.status } };
    }

    case 'sim-expire-pi': {
      // Mark the order's simulated PaymentIntent as a dead auth so the next
      // ship exercises the guard (never capture dead money). Encoded in the id
      // (stateless) since the sim's in-process state doesn't survive across the
      // dev worker's per-request module re-eval.
      const { data: order } = await db.from('orders')
        .select('id, stripe_payment_intent_id').eq('listing_id', p.listing_id as string)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (order?.id) {
        await db.from('orders').update({
          stripe_payment_intent_id: `${order.stripe_payment_intent_id ?? 'pi_sim'}_canceled`,
        }).eq('id', order.id);
      }
      return { data: { expired: true } };
    }

    case 'submit-seller-review': {
      if (!actorId) throw new Error('Actor required');
      const result = await svcSubmitSellerReview(synthCtx(db, actorId), {
        listingId: p.listing_id as string,
        rating: (p.rating as number) ?? 5,
        comment: p.comment as string | undefined,
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { data: result.data };
    }

    // ── Listing & messaging ──────────────────────────

    case 'create-listing': {
      if (!actorId) throw new Error('Actor required');
      const { data, error } = await db.from('listings').insert({
        seller_id: actorId,
        kind: p.kind ?? 'pre_loved',
        title: p.title ?? 'Test-annonse',
        category: p.category ?? 'genser',
        size_label: p.size_label ?? '2 år',
        price_nok: p.price_nok ?? 249,
        // condition only applies to pre-loved items; ready_made has none.
        condition: p.kind === 'ready_made' ? null : (p.condition ?? 'lite_brukt'),
        description: p.description ?? 'Testannonse fra kontrollpanelet.',
        status: 'draft',
      }).select().single();
      if (error) throw error;

      const photoCount = Number(p.photo_count ?? 1);
      if (photoCount > 0) {
        const cat = String(p.category ?? 'genser');
        const colors = TEST_COLORS[cat] ?? TEST_COLORS.annet;
        for (let i = 0; i < Math.min(photoCount, 6); i++) {
          const png = await makeTestPng(colors[i % colors.length]);
          const path = `${actorId}/listings/${data.id}/photo-${crypto.randomUUID()}.png`;
          await db.storage.from('projects').upload(path, png, { contentType: 'image/png', upsert: false });
          await db.from('listing_photos').insert({ listing_id: data.id, path, position: i });
        }
        const { data: first } = await db.from('listing_photos').select('path').eq('listing_id', data.id).order('position').limit(1).maybeSingle();
        if (first) await db.from('listings').update({ hero_photo_path: first.path }).eq('id', data.id);
      }

      return { data };
    }

    case 'publish-listing': {
      // Resolve the seller (test-exec callers do not pass actorId here).
      const { data: l } = await db.from('listings').select('seller_id').eq('id', p.listing_id).maybeSingle();
      if (!l?.seller_id) throw new Error('Listing not found');
      const result = await svcPublishListing(synthCtx(db, l.seller_id), { listingId: p.listing_id as string });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { data: { status: 'active' } };
    }

    case 'send-message': {
      if (!actorId) throw new Error('Actor required');
      const { data: listing } = await db.from('listings')
        .select('seller_id, title')
        .eq('id', p.listing_id)
        .single();
      if (!listing) throw new Error('Listing not found');

      const { data: existing } = await db.from('marketplace_conversations')
        .select('id')
        .eq('listing_id', p.listing_id as string)
        .eq('buyer_id', actorId)
        .maybeSingle();

      let convId: string;
      if (existing) {
        convId = existing.id;
      } else {
        const { data: conv, error } = await db.from('marketplace_conversations').insert({
          listing_id: p.listing_id,
          buyer_id: actorId,
          seller_id: listing.seller_id,
        }).select().single();
        if (error) throw error;
        convId = conv.id;
      }

      const { data: msg, error } = await db.from('marketplace_messages').insert({
        conversation_id: convId,
        sender_id: actorId,
        body: p.message ?? 'Hei! Er denne fortsatt tilgjengelig?',
      }).select().single();
      if (error) throw error;

      await db.from('notifications').insert({
        user_id: listing.seller_id,
        type: 'new_message',
        title: 'Ny melding',
        body: `Om «${listing.title}»`,
        url: `/market/messages/${convId}`,
        actor_id: actorId,
      });

      return { data: { conversationId: convId, message: msg } };
    }

    case 'reply': {
      if (!actorId) throw new Error('Actor required');
      const { data: conv } = await db.from('marketplace_conversations')
        .select('buyer_id, seller_id, listing_id, listings!inner(title)')
        .eq('id', p.conversation_id)
        .single();

      const { data: msg, error } = await db.from('marketplace_messages').insert({
        conversation_id: p.conversation_id,
        sender_id: actorId,
        body: p.message ?? 'Takk for meldingen!',
      }).select().single();
      if (error) throw error;

      if (conv) {
        const recipientId = actorId === conv.buyer_id ? conv.seller_id : conv.buyer_id;
        await db.from('notifications').insert({
          user_id: recipientId,
          type: 'new_message',
          title: 'Ny melding',
          body: `Om «${(conv as any).listings?.title}»`,
          url: `/market/messages/${p.conversation_id}`,
          actor_id: actorId,
        });
      }

      return { data: { message: msg } };
    }

    // ── Moderation flow ────────────────────────────────

    case 'set-role': {
      if (!actorId) throw new Error('Actor required');
      const role = p.role || null;
      await db.from('profiles').update({ role }).eq('id', actorId);
      return { data: { role, user_id: actorId } };
    }

    case 'set-profile-visible': {
      if (!actorId) throw new Error('Actor required');
      await db.from('profiles').update({ profile_visible: p.visible !== false }).eq('id', actorId);
      return { data: { user_id: actorId, visible: p.visible !== false } };
    }

    case 'lookup-user': {
      const email = p.email as string | undefined;
      if (!email) throw new Error('email required');
      const id = emailToId.get(email);
      if (!id) throw new Error(`No test user with email ${email}`);
      return { data: { id, email } };
    }

    case 'count-notifications': {
      if (!actorId) throw new Error('Actor required');
      let query = db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', actorId);
      if (p.type) query = query.eq('type', p.type);
      const { count } = await query;
      return { data: { count: count ?? 0 } };
    }

    // Single-shot prep for the full-buyflow demo: Eline trusted+onboarded,
    // brand new listing with two photos, status=active. Used by the
    // /dev/ui-flows "Full E2E" scenario.
    case 'seed-buyflow-listing': {
      const elineId = emailToId.get('eline@test.strikketorget.no');
      const livId = emailToId.get('liv@test.strikketorget.no');
      if (!elineId || !livId) throw new Error('seed-buyflow-listing needs user_emails: [eline, liv]');
      await db.from('profiles').update({
        profile_visible: true,
        trust_score: 100, trust_tier: 'trusted',
      }).eq('id', elineId);
      await db.from('seller_profiles').upsert({
        id: elineId,
        stripe_account_id: 'acct_test_' + elineId.slice(0, 8),
        stripe_connect_status: 'verified',
        seller_verified_at: new Date().toISOString(),
      });
      await db.from('profiles').update({ profile_visible: true }).eq('id', livId);

      const cat = 'genser';
      const { data: l, error } = await db.from('listings').insert({
        seller_id: elineId,
        kind: 'pre_loved',
        title: 'E2E demo: Strikket genser str. 2 år',
        category: cat,
        size_label: '2 år',
        price_nok: 350,
        condition: 'lite_brukt',
        description: 'Demo-annonse for full kjøp-flyt.',
        status: 'active',
        published_at: new Date().toISOString(),
        listing_fee_nok: 29,
        shipping_option: 'small_parcel',
        shipping_price_nok: 76,
        escrow_enabled: true,
      }).select('id').single();
      if (error) throw error;

      const colors = TEST_COLORS[cat] ?? TEST_COLORS.annet;
      for (let i = 0; i < 2; i++) {
        const png = await makeTestPng(colors[i % colors.length]);
        const path = `${elineId}/listings/${l.id}/photo-${crypto.randomUUID()}.png`;
        await db.storage.from('projects').upload(path, png, { contentType: 'image/png', upsert: false });
        await db.from('listing_photos').insert({ listing_id: l.id, path, position: i });
      }
      const { data: first } = await db.from('listing_photos').select('path').eq('listing_id', l.id).order('position').limit(1).maybeSingle();
      if (first) await db.from('listings').update({ hero_photo_path: first.path }).eq('id', l.id);

      return { data: { elineId, livId, listingId: l.id } };
    }

    case 'seed-store': {
      // Bypass the Brønnøysund lookup that /api/stores requires - we
      // just need an active store with the actor as owner so flow specs
      // can exercise the storefront + admin views without hitting an
      // external API.
      if (!actorId) throw new Error('Actor required');
      const slug = (p.slug as string) ?? `e2e-strikkebutikk-${Date.now()}`;
      const orgnr = (p.orgnr as string) ?? String(Math.floor(900000000 + Math.random() * 99999999));
      const name = (p.name as string) ?? 'E2E demo: Tråd & Garn';
      const { data: store, error } = await db.from('stores').insert({
        slug,
        orgnr,
        created_by: actorId,
        legal_name: 'TRÅD OG GARN AS',
        legal_address: 'Storgata 1, 0123 Oslo',
        legal_business_type: 'AS',
        legal_status: 'aktiv',
        name,
        tagline: 'Håndlagde plagg, fra norske strikkere.',
        location_city: 'Oslo',
        contact_email: 'hei@trad-og-garn.no',
        status: 'active',
      }).select('id, slug').single();
      if (error) throw error;

      const { error: memErr } = await db.from('store_members').insert({
        store_id: store.id,
        user_id: actorId,
        role: 'owner',
        visible_on_storefront: true,
      });
      if (memErr) throw memErr;

      return { data: { storeId: store.id, slug: store.slug } };
    }

    case 'count-follows': {
      const sellerId = p.seller_id as string | undefined;
      if (!sellerId) throw new Error('seller_id required');
      const { count } = await db.from('seller_follows').select('follower_id', { count: 'exact', head: true }).eq('seller_id', sellerId);
      return { data: { count: count ?? 0 } };
    }

    // Build a representative scenario for /dev/screens manual review:
    // - Eline: trusted seller, profile visible, one published listing,
    //   one draft without photos (→ wizard step 3 page is meaningful),
    //   one draft with photos but not published.
    // - Liv: follows Eline → home shows the follow row + has notifications.
    case 'seed-screens': {
      // Caller must pass user_emails: [ELINE, LIV] so the outer handler
      // creates them via ensureTestUser before we land here.
      const elineId = emailToId.get('eline@test.strikketorget.no');
      const livId = emailToId.get('liv@test.strikketorget.no');
      if (!elineId || !livId) throw new Error('seed-screens needs user_emails: [eline, liv]');
      await db.from('profiles').update({
        profile_visible: true, trust_score: 100, trust_tier: 'trusted',
      }).eq('id', elineId);
      await db.from('seller_profiles').upsert({
        id: elineId,
        stripe_account_id: 'acct_test_' + elineId.slice(0, 8),
        stripe_connect_status: 'verified',
        seller_verified_at: new Date().toISOString(),
      });
      await db.from('profiles').update({ profile_visible: true }).eq('id', livId);

      // Narrowed alias so closures below carry non-null type from the
      // null-guard above.
      const sellerId = elineId;
      async function listing(opts: { title: string; status: 'draft' | 'active' | 'sold'; photoCount: number; category?: 'genser' | 'cardigan' | 'lue' | 'bukser' | 'sokker' | 'teppe' | 'votter' | 'kjole' | 'annet' }) {
        const cat = opts.category ?? 'genser';
        const { data, error } = await db.from('listings').insert({
          seller_id: sellerId,
          kind: 'pre_loved',
          title: opts.title,
          category: cat,
          size_label: '2 år',
          price_nok: 349,
          condition: 'lite_brukt',
          description: 'Demo-annonse for /dev/screens.',
          status: opts.status,
          published_at: opts.status === 'active' ? new Date().toISOString() : null,
          listing_fee_nok: opts.status === 'active' ? 29 : null,
        }).select('id').single();
        if (error) throw error;
        if (opts.photoCount > 0) {
          const colors = TEST_COLORS[cat] ?? TEST_COLORS.annet;
          for (let i = 0; i < Math.min(opts.photoCount, 6); i++) {
            const png = await makeTestPng(colors[i % colors.length]);
            const path = `${elineId}/listings/${data.id}/photo-${crypto.randomUUID()}.png`;
            await db.storage.from('projects').upload(path, png, { contentType: 'image/png', upsert: false });
            await db.from('listing_photos').insert({ listing_id: data.id, path, position: i });
          }
          const { data: first } = await db.from('listing_photos').select('path').eq('listing_id', data.id).order('position').limit(1).maybeSingle();
          if (first) await db.from('listings').update({ hero_photo_path: first.path }).eq('id', data.id);
        }
        return data.id;
      }

      const liveId = await listing({ title: 'Strikket genser str 2 år (publisert)', status: 'active', photoCount: 2 });
      const draftEmptyId = await listing({ title: 'Mariusgenser str 4 år (utkast, ingen bilder)', status: 'draft', photoCount: 0 });
      const draftReadyId = await listing({ title: 'Babylue rosa (utkast, har bilder)', status: 'draft', photoCount: 3, category: 'lue' });

      // Liv follows Eline.
      await db.from('seller_follows').upsert(
        { follower_id: livId, seller_id: elineId },
        { onConflict: 'follower_id,seller_id' }
      );

      // One unread notification for Liv (so /notifications has content).
      await db.from('notifications').insert({
        user_id: livId, type: 'seller_new_listing',
        title: 'Eline la ut en ny annonse', body: '«Strikket genser str 2 år (publisert)» er nå tilgjengelig.',
        url: `/market/listing/${liveId}`,
        actor_id: elineId, reference_id: liveId,
      });

      // The home "Nye fra sellere du følger" row reads from the matview;
      // refresh so the seed is visible immediately.
      await db.rpc('refresh_user_preferences');

      return { data: { elineId, livId, liveListingId: liveId, draftEmptyId, draftReadyId } };
    }

    case 'set-trust': {
      if (!actorId) throw new Error('Actor required');
      await db.from('profiles').update({
        trust_score: p.trust_score ?? 0,
        trust_tier: p.trust_tier ?? 'new',
        total_completed_transactions: p.total_completed_transactions ?? 0,
        total_rejections: p.total_rejections ?? 0,
      }).eq('id', actorId);
      return { data: { trust_score: p.trust_score, trust_tier: p.trust_tier, user_id: actorId } };
    }

    case 'set-mod-stats': {
      if (!actorId) throw new Error('Actor required');
      const { data: existing } = await db.from('moderator_stats')
        .select('user_id').eq('user_id', actorId).maybeSingle();

      const stats = {
        total_reviews: p.total_reviews ?? 0,
        total_approvals: p.total_approvals ?? 0,
        total_rejections: p.total_rejections ?? 0,
        shadow_overrides: p.shadow_overrides ?? 0,
        current_month_reviews: p.current_month_reviews ?? 0,
        current_month_earned_nok: p.current_month_earned_nok ?? 0,
        total_earned_nok: p.total_earned_nok ?? 0,
        rate_nok_per_review: p.rate_nok_per_review ?? 1.00,
      };

      if (existing) {
        await db.from('moderator_stats').update(stats).eq('user_id', actorId);
      } else {
        await db.from('moderator_stats').insert({ user_id: actorId, ...stats });
      }
      return { data: { ...stats, user_id: actorId } };
    }

    case 'create-listing-moderated': {
      if (!actorId) throw new Error('Actor required');
      const { data: listing, error } = await db.from('listings').insert({
        seller_id: actorId,
        kind: p.kind ?? 'pre_loved',
        title: p.title ?? 'Test-annonse',
        category: p.category ?? 'genser',
        size_label: p.size_label ?? '2 år',
        price_nok: p.price_nok ?? 249,
        condition: p.condition ?? 'lite_brukt',
        description: p.description ?? 'Testannonse for moderering.',
        status: 'pending_review',
      }).select().single();
      if (error) throw error;

      const modPhotoCount = Number(p.photo_count ?? 1);
      if (modPhotoCount > 0) {
        const cat = String(p.category ?? 'genser');
        const colors = TEST_COLORS[cat] ?? TEST_COLORS.annet;
        for (let i = 0; i < Math.min(modPhotoCount, 6); i++) {
          const png = await makeTestPng(colors[i % colors.length]);
          const path = `${actorId}/listings/${listing.id}/photo-${crypto.randomUUID()}.png`;
          await db.storage.from('projects').upload(path, png, { contentType: 'image/png', upsert: false });
          await db.from('listing_photos').insert({ listing_id: listing.id, path, position: i });
        }
        const { data: first } = await db.from('listing_photos').select('path').eq('listing_id', listing.id).order('position').limit(1).maybeSingle();
        if (first) await db.from('listings').update({ hero_photo_path: first.path }).eq('id', listing.id);
      }

      const { data: qi, error: qError } = await db.from('moderation_queue').insert({
        item_type: 'listing',
        item_id: listing.id,
        submitter_id: actorId,
      }).select().single();
      if (qError) throw qError;

      return { data: { ...listing, queue_item_id: qi.id } };
    }

    case 'create-request-moderated': {
      if (!actorId) throw new Error('Actor required');
      const { data: req, error } = await db.from('commission_requests').insert({
        buyer_id: actorId,
        title: p.title ?? 'Test-oppdrag',
        category: p.category ?? 'genser',
        size_label: p.size_label ?? '2 år',
        budget_nok_min: p.budget_nok_min ?? 800,
        budget_nok_max: p.budget_nok_max ?? 1500,
        description: p.description ?? 'Testoppdrag for moderering.',
        status: 'pending_review',
        offer_count: 0,
      }).select().single();
      if (error) throw error;

      const { data: qi, error: qError } = await db.from('moderation_queue').insert({
        item_type: 'commission_request',
        item_id: req.id,
        submitter_id: actorId,
      }).select().single();
      if (qError) throw qError;

      return { data: { ...req, queue_item_id: qi.id } };
    }

    case 'moderate-review': {
      if (!actorId) throw new Error('Actor required');
      const decision = String(p.decision);
      if (!['approve', 'reject', 'escalate'].includes(decision)) throw new Error('Invalid decision');

      const { data: qi } = await db.from('moderation_queue')
        .select('*').eq('id', p.queue_item_id).single();
      if (!qi) throw new Error('Queue item not found');

      if (qi.submitter_id === actorId) throw new Error('Cannot review own submission');

      // Select ALL columns the earnings update reads below — selecting only
      // total_reviews/shadow_overrides meant current_month_reviews was
      // undefined, so `undefined + 1 || 1` pinned month reviews at 1 and
      // earnings never accumulated (caught by the CI scenario runner).
      const { data: modStats } = await db.from('moderator_stats')
        .select('total_reviews, shadow_overrides, total_approvals, total_rejections, current_month_reviews, current_month_earned_nok, total_earned_nok')
        .eq('user_id', actorId).maybeSingle();
      const totalReviews = modStats?.total_reviews ?? 0;
      const isShadow = totalReviews < 50;
      const forceSpotCheck = !!p.force_spot_check;
      const isSpotCheck = !isShadow && (forceSpotCheck || Math.random() < 0.10);

      const now = new Date().toISOString();
      const status = decision === 'escalate' ? 'escalated' : decision === 'approve' ? 'approved' : 'rejected';

      await db.from('moderation_queue').update({
        status,
        decision_by: actorId,
        decision_at: now,
        rejection_reason: p.rejection_reason ?? null,
        internal_notes: p.internal_notes ?? null,
        shadow_review: isShadow,
        spot_check: isSpotCheck,
      }).eq('id', p.queue_item_id);

      await db.from('moderation_audit_log').insert({
        actor_id: actorId,
        action: decision,
        target_type: qi.item_type,
        target_id: qi.item_id,
        queue_item_id: String(p.queue_item_id),
        details: { shadow: isShadow, spot_check: isSpotCheck },
      });

      if (decision !== 'escalate') {
        const rate = totalReviews >= 50 && (modStats?.shadow_overrides ?? 0) < 3 ? 2.0 : 1.0;
        const { data: existing } = await db.from('moderator_stats')
          .select('user_id').eq('user_id', actorId).maybeSingle();

        if (existing) {
          await db.from('moderator_stats').update({
            total_reviews: totalReviews + 1,
            [`total_${decision === 'approve' ? 'approvals' : 'rejections'}`]: ((modStats as any)?.[`total_${decision === 'approve' ? 'approvals' : 'rejections'}`] ?? 0) + 1,
            current_month_reviews: (modStats as any)?.current_month_reviews + 1 || 1,
            current_month_earned_nok: ((modStats as any)?.current_month_earned_nok ?? 0) + rate,
            total_earned_nok: ((modStats as any)?.total_earned_nok ?? 0) + rate,
            rate_nok_per_review: rate,
            last_review_at: now,
          } as never).eq('user_id', actorId);
        } else {
          await db.from('moderator_stats').insert({
            user_id: actorId,
            total_reviews: 1,
            total_approvals: decision === 'approve' ? 1 : 0,
            total_rejections: decision === 'reject' ? 1 : 0,
            current_month_reviews: 1,
            current_month_earned_nok: rate,
            total_earned_nok: rate,
            rate_nok_per_review: rate,
            last_review_at: now,
          });
        }
      }

      if (!isShadow && decision === 'approve') {
        if (qi.item_type === 'listing') {
          await db.from('listings').update({
            status: 'active', published_at: now, reviewed_at: now, reviewed_by: actorId,
          }).eq('id', qi.item_id);
        } else {
          await db.from('commission_requests').update({
            status: 'open', reviewed_at: now, reviewed_by: actorId,
          }).eq('id', qi.item_id);
        }
      }

      if (!isShadow && decision === 'reject') {
        if (qi.item_type === 'listing') {
          await db.from('listings').update({
            status: 'rejected', moderation_notes: p.rejection_reason ?? null,
            reviewed_at: now, reviewed_by: actorId,
          }).eq('id', qi.item_id);
        } else {
          await db.from('commission_requests').update({
            status: 'rejected', moderation_notes: p.rejection_reason ?? null,
            reviewed_at: now, reviewed_by: actorId,
          }).eq('id', qi.item_id);
        }
        await db.from('profiles').update({
          total_rejections: ((await db.from('profiles').select('total_rejections').eq('id', qi.submitter_id).single()).data?.total_rejections ?? 0) + 1,
        }).eq('id', qi.submitter_id);
      }

      return { data: { status, shadow_review: isShadow, spot_check: isSpotCheck, queue_item_id: p.queue_item_id } };
    }

    case 'shadow-confirm': {
      if (!actorId) throw new Error('Actor required');
      const confirmAction = String(p.action);
      if (!['confirm', 'override'].includes(confirmAction)) throw new Error('Invalid action');

      const now = new Date().toISOString();

      const { data: qi } = await db.from('moderation_queue')
        .select('*').eq('id', p.queue_item_id)
        .eq('shadow_review', true).is('shadow_confirmed_at', null).single();
      if (!qi) throw new Error('Shadow queue item not found');

      if (confirmAction === 'confirm') {
        await db.from('moderation_queue').update({
          shadow_confirmed_at: now, shadow_confirmed_by: actorId,
        }).eq('id', p.queue_item_id);

        if (qi.status === 'approved') {
          if (qi.item_type === 'listing') {
            await db.from('listings').update({
              status: 'active', published_at: now, reviewed_at: now, reviewed_by: qi.decision_by,
            }).eq('id', qi.item_id);
          } else {
            await db.from('commission_requests').update({
              status: 'open', reviewed_at: now, reviewed_by: qi.decision_by,
            }).eq('id', qi.item_id);
          }
        } else if (qi.status === 'rejected') {
          if (qi.item_type === 'listing') {
            await db.from('listings').update({
              status: 'rejected', reviewed_at: now, reviewed_by: qi.decision_by,
            }).eq('id', qi.item_id);
          } else {
            await db.from('commission_requests').update({
              status: 'rejected', reviewed_at: now, reviewed_by: qi.decision_by,
            }).eq('id', qi.item_id);
          }
        }

        await db.from('moderation_audit_log').insert({
          actor_id: actorId, action: 'shadow_confirm',
          target_type: qi.item_type, target_id: qi.item_id,
          queue_item_id: String(p.queue_item_id),
        });
      } else {
        const overriddenStatus = qi.status === 'approved' ? 'rejected' : 'approved';
        await db.from('moderation_queue').update({
          status: overriddenStatus,
          shadow_confirmed_at: now, shadow_confirmed_by: actorId,
          shadow_decision_overridden: true,
        }).eq('id', p.queue_item_id);

        if (qi.decision_by) {
          const { data: ms } = await db.from('moderator_stats')
            .select('shadow_overrides').eq('user_id', qi.decision_by).maybeSingle();
          await db.from('moderator_stats').update({
            shadow_overrides: (ms?.shadow_overrides ?? 0) + 1,
          }).eq('user_id', qi.decision_by);
        }

        if (overriddenStatus === 'approved') {
          if (qi.item_type === 'listing') {
            await db.from('listings').update({
              status: 'active', published_at: now, reviewed_at: now, reviewed_by: actorId,
            }).eq('id', qi.item_id);
          } else {
            await db.from('commission_requests').update({
              status: 'open', reviewed_at: now, reviewed_by: actorId,
            }).eq('id', qi.item_id);
          }
        } else {
          if (qi.item_type === 'listing') {
            await db.from('listings').update({
              status: 'rejected', reviewed_at: now, reviewed_by: actorId,
            }).eq('id', qi.item_id);
          } else {
            await db.from('commission_requests').update({
              status: 'rejected', reviewed_at: now, reviewed_by: actorId,
            }).eq('id', qi.item_id);
          }
        }

        await db.from('moderation_audit_log').insert({
          actor_id: actorId, action: 'shadow_override',
          target_type: qi.item_type, target_id: qi.item_id,
          queue_item_id: String(p.queue_item_id),
          details: { original: qi.status, overridden_to: overriddenStatus },
        });
      }

      return { data: { action: confirmAction, queue_item_id: p.queue_item_id } };
    }

    case 'spot-check-review': {
      if (!actorId) throw new Error('Actor required');
      const agrees = p.agrees === true;
      const now = new Date().toISOString();

      await db.from('moderation_queue').update({
        spot_check_at: now, spot_check_by: actorId, spot_check_agreed: agrees,
      }).eq('id', p.queue_item_id);

      if (!agrees) {
        const { data: qi } = await db.from('moderation_queue')
          .select('decision_by').eq('id', p.queue_item_id).single();
        if (qi?.decision_by) {
          const { data: ms } = await db.from('moderator_stats')
            .select('spot_check_disagreements').eq('user_id', qi.decision_by).maybeSingle();
          await db.from('moderator_stats').update({
            spot_check_disagreements: (ms?.spot_check_disagreements ?? 0) + 1,
          }).eq('user_id', qi.decision_by);
        }
      }

      await db.from('moderation_audit_log').insert({
        actor_id: actorId,
        action: agrees ? 'spot_check_agree' : 'spot_check_disagree',
        target_type: 'moderation_queue', target_id: String(p.queue_item_id),
        queue_item_id: String(p.queue_item_id),
      });

      return { data: { agreed: agrees } };
    }

    case 'submit-report': {
      if (!actorId) throw new Error('Actor required');
      const { data, error } = await db.from('reports').insert({
        reporter_id: actorId,
        target_type: p.target_type ?? 'listing',
        target_id: p.target_id,
        reason: p.reason ?? 'scam',
        description: p.description ?? null,
      }).select().single();
      if (error) throw error;
      return { data };
    }

    case 'resolve-report': {
      if (!actorId) throw new Error('Actor required');
      const now = new Date().toISOString();
      await db.from('reports').update({
        status: p.dismiss ? 'dismissed' : 'resolved',
        resolved_by: actorId,
        resolved_at: now,
        resolution_notes: p.notes ?? null,
      }).eq('id', p.report_id);

      await db.from('moderation_audit_log').insert({
        actor_id: actorId,
        action: p.dismiss ? 'report_dismiss' : 'report_resolve',
        target_type: 'report', target_id: String(p.report_id),
      });

      return { data: { resolved: true } };
    }

    case 'submit-tx-review': {
      if (!actorId) throw new Error('Actor required');
      const { data: req } = await db.from('commission_requests')
        .select('buyer_id').eq('id', p.commission_request_id).single();
      if (!req) throw new Error('Commission not found');

      const { data: offer } = await db.from('commission_offers')
        .select('knitter_id').eq('request_id', p.commission_request_id as string)
        .eq('status', 'accepted').maybeSingle();
      if (!offer) throw new Error('No accepted offer');

      const isBuyer = actorId === req.buyer_id;
      const revieweeId = isBuyer ? offer.knitter_id : req.buyer_id;

      const { data, error } = await db.from('transaction_reviews').insert({
        commission_request_id: p.commission_request_id,
        reviewer_id: actorId,
        reviewee_id: revieweeId,
        reviewer_role: isBuyer ? 'buyer' : 'knitter',
        rating: p.rating ?? 5,
        comment: p.comment ?? null,
      }).select().single();
      if (error) throw error;

      return { data };
    }

    case 'generate-payouts': {
      if (!actorId) throw new Error('Actor required');
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

      const { data: stats } = await db.from('moderator_stats')
        .select('user_id, current_month_reviews, current_month_earned_nok')
        .gt('current_month_reviews', 0);

      if (!stats?.length) return { data: { count: 0 } };

      const payouts = stats.map(s => ({
        moderator_id: s.user_id,
        period_start: periodStart,
        period_end: periodEnd,
        review_count: s.current_month_reviews,
        amount_nok: s.current_month_earned_nok,
        status: 'pending',
      }));

      const { data: inserted } = await db.from('moderator_payouts').insert(payouts).select('id');
      return { data: { count: payouts.length, total_nok: payouts.reduce((s, p) => s + p.amount_nok, 0), first_payout_id: inserted?.[0]?.id } };
    }

    case 'mark-payout-paid': {
      await db.from('moderator_payouts').update({
        status: 'paid', paid_at: new Date().toISOString(),
      }).eq('id', p.payout_id);
      return { data: { paid: true } };
    }

    // ── State inspection ─────────────────────────────

    case 'get-state': {
      const result: Record<string, unknown> = {};

      if (p.request_id) {
        const { data: req } = await db.from('commission_requests')
          .select('*')
          .eq('id', p.request_id)
          .single();
        result.request = req;

        if (req) {
          const { data: offers } = await db.from('commission_offers')
            .select('id, knitter_id, price_nok, turnaround_weeks, message, status, created_at, profiles!commission_offers_knitter_id_fkey(display_name)')
            .eq('request_id', p.request_id as string)
            .order('created_at');
          result.offers = offers;

          if (req.awarded_offer_id) {
            const { data: project } = await db.from('projects')
              .select('id, title, status, started_at, finished_at')
              .eq('commission_offer_id', req.awarded_offer_id)
              .maybeSingle();
            result.project = project;
          }

          // Commission money ledger (separate charges & transfers) so scenarios
          // can assert captured/released/refunded events + amounts.
          const { data: events } = await db.from('payment_events')
            .select('kind, event_type, amount_nok, fee_nok, actor_id, occurred_at')
            .eq('commission_request_id', p.request_id as string)
            .order('occurred_at', { ascending: true });
          result.payment_events = events;
        }
      }

      if (p.listing_id) {
        const { data: listing } = await db.from('listings')
          .select('*')
          .eq('id', p.listing_id)
          .single();
        result.listing = listing;

        // The purchase entity (money, PII, lifecycle, Stripe refs) lives on the
        // ORDER now (orders extraction) — not the listing. Surface the latest
        // order + its ledger so scenarios assert the real post-refactor state.
        const { data: order } = await db.from('orders')
          .select('*')
          .eq('listing_id', p.listing_id as string)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        result.order = order;
        if (order?.id) {
          const { data: events } = await db.from('payment_events')
            .select('kind, event_type, amount_nok, fee_nok, actor_id, occurred_at')
            .eq('order_id', order.id)
            .order('occurred_at', { ascending: true });
          result.payment_events = events;
        }

        const { data: convos } = await db.from('marketplace_conversations')
          .select('id, buyer_id, created_at, marketplace_messages(id, sender_id, body, created_at)')
          .eq('listing_id', p.listing_id as string)
          .order('created_at', { ascending: false });
        result.conversations = convos;

        if (listing?.seller_id) {
          const { data: sellerRevs } = await db.from('seller_reviews')
            .select('*')
            .eq('listing_id', p.listing_id as string);
          result.seller_reviews = sellerRevs;
        }
      }

      if (p.queue_item_id) {
        const { data: qi } = await db.from('moderation_queue')
          .select('*').eq('id', p.queue_item_id).maybeSingle();
        result.queue_item = qi;
      }

      if (p.include_queue) {
        const { data: queue } = await db.from('moderation_queue')
          .select('*').order('created_at', { ascending: false }).limit(20);
        result.queue = queue;
      }

      if (p.include_mod_stats && Array.isArray(p.user_emails)) {
        const modStats: Record<string, unknown> = {};
        for (const email of p.user_emails as string[]) {
          const uid = emailToId.get(email);
          if (!uid) continue;
          const { data } = await db.from('moderator_stats')
            .select('*').eq('user_id', uid).maybeSingle();
          if (data) modStats[email] = data;
        }
        result.mod_stats = modStats;
      }

      if (p.include_reports) {
        const { data: reports } = await db.from('reports')
          .select('*').order('created_at', { ascending: false }).limit(20);
        result.reports = reports;
      }

      if (p.include_tx_reviews && p.request_id) {
        const { data: reviews } = await db.from('transaction_reviews')
          .select('*').eq('commission_request_id', p.request_id as string);
        result.tx_reviews = reviews;
      }

      if (p.include_payouts) {
        const { data: payouts } = await db.from('moderator_payouts')
          .select('*').order('created_at', { ascending: false }).limit(20);
        result.payouts = payouts;
      }

      if (p.include_profiles && Array.isArray(p.user_emails)) {
        const profiles: Record<string, unknown> = {};
        for (const email of p.user_emails as string[]) {
          const uid = emailToId.get(email);
          if (!uid) continue;
          const { data } = await db.from('profiles')
            .select('id, display_name, role, trust_score, trust_tier, total_completed_transactions, total_rejections')
            .eq('id', uid).maybeSingle();
          // stripe_connect_status / stripe_account_id moved to seller_profiles
          // in the 0072 profile split — fold them back in for assertions.
          const { data: seller } = await db.from('seller_profiles')
            .select('stripe_connect_status, stripe_account_id')
            .eq('id', uid).maybeSingle();
          if (data) profiles[email] = { ...data, stripe_connect_status: seller?.stripe_connect_status ?? null, stripe_account_id: seller?.stripe_account_id ?? null };
        }
        result.profiles = profiles;
      }

      if (Array.isArray(p.user_emails)) {
        const notifs: Record<string, unknown[]> = {};
        for (const email of p.user_emails as string[]) {
          const uid = emailToId.get(email);
          if (!uid) continue;
          const { data } = await db.from('notifications')
            .select('id, type, title, body, url, read_at, created_at')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(20);
          notifs[email] = data ?? [];
        }
        result.notifications = notifs;
      }

      return { data: result };
    }

    // ── Cleanup ──────────────────────────────────────

    case 'cleanup': {
      const testUserIds = [...emailToId.entries()]
        .filter(([e]) => e.endsWith('@test.strikketorget.no'))
        .map(([, id]) => id);

      if (testUserIds.length === 0) return { data: { cleaned: true, deleted: 0 } };

      // Find all commission requests by test users
      const { data: testRequests } = await db.from('commission_requests')
        .select('id, awarded_offer_id')
        .in('buyer_id', testUserIds);

      for (const req of testRequests ?? []) {
        if (req.awarded_offer_id) {
          await db.from('projects').delete().eq('commission_offer_id', req.awarded_offer_id);
        }
        await db.from('commission_offers').delete().eq('request_id', req.id);
        await db.from('notifications').delete().eq('reference_id', req.id);
        await db.from('commission_requests').delete().eq('id', req.id);
      }

      // Find all offers by test knitters (on non-test requests)
      const { data: testOffers } = await db.from('commission_offers')
        .select('id')
        .in('knitter_id', testUserIds);
      for (const o of testOffers ?? []) {
        await db.from('notifications').delete().eq('reference_id', o.id);
      }
      await db.from('commission_offers').delete().in('knitter_id', testUserIds);

      // Projects owned by test users
      await db.from('project_logs').delete().in('user_id', testUserIds);
      await db.from('projects').delete().in('user_id', testUserIds);

      // Listings + conversations
      const { data: testListings } = await db.from('listings')
        .select('id')
        .in('seller_id', testUserIds);
      for (const l of testListings ?? []) {
        const { data: photos } = await db.from('listing_photos')
          .select('path').eq('listing_id', l.id);
        if (photos?.length) {
          await db.storage.from('projects').remove(photos.map(p => p.path));
        }
        await db.from('listing_photos').delete().eq('listing_id', l.id);

        const { data: convos } = await db.from('marketplace_conversations')
          .select('id')
          .eq('listing_id', l.id);
        for (const c of convos ?? []) {
          await db.from('marketplace_messages').delete().eq('conversation_id', c.id);
        }
        await db.from('marketplace_conversations').delete().eq('listing_id', l.id);
      }
      await db.from('listings').delete().in('seller_id', testUserIds);

      // Conversations started by test buyers
      const { data: buyerConvos } = await db.from('marketplace_conversations')
        .select('id')
        .in('buyer_id', testUserIds);
      for (const c of buyerConvos ?? []) {
        await db.from('marketplace_messages').delete().eq('conversation_id', c.id);
      }
      await db.from('marketplace_conversations').delete().in('buyer_id', testUserIds);

      // Moderation data for test users
      await db.from('moderation_audit_log').delete().in('actor_id', testUserIds);
      await db.from('moderator_payouts').delete().in('moderator_id', testUserIds);
      await db.from('moderator_stats').delete().in('user_id', testUserIds);
      // seller_profiles carries stripe_connect_status — reset it so a verified
      // seller in one scenario doesn't leak into the next.
      await db.from('seller_profiles').delete().in('id', testUserIds);
      await db.from('reports').delete().in('reporter_id', testUserIds);
      await db.from('seller_reviews').delete().in('reviewer_id', testUserIds);
      await db.from('transaction_reviews').delete().in('reviewer_id', testUserIds);
      await db.from('seller_follows').delete().in('follower_id', testUserIds);
      await db.from('seller_follows').delete().in('seller_id', testUserIds);

      // Queue items submitted by or decided by test users
      await db.from('moderation_queue').delete().in('submitter_id', testUserIds);
      await db.from('moderation_queue').delete().in('decision_by', testUserIds);

      // Stores: any store created by a test user or that a test user belongs to
      const { data: ownedStores } = await db.from('stores').select('id').in('created_by', testUserIds);
      const { data: memberStores } = await db.from('store_members').select('store_id').in('user_id', testUserIds);
      const storeIds = new Set<string>([
        ...(ownedStores ?? []).map((s: any) => s.id),
        ...(memberStores ?? []).map((m: any) => m.store_id),
      ]);
      if (storeIds.size > 0) {
        const ids = [...storeIds];
        // Detach store_id from any remaining listings/reviews so cascades stay clean
        await db.from('listings').update({ store_id: null }).in('store_id', ids);
        await db.from('seller_reviews').update({ store_id: null }).in('store_id', ids);
        await db.from('store_invitations').delete().in('store_id', ids);
        await db.from('store_members').delete().in('store_id', ids);
        await db.from('stores').delete().in('id', ids);
      }

      // Reset roles, trust, and onboarding fields for test users so each
      // test starts from a clean state.
      await db.from('profiles').update({
        role: null, trust_score: 0, trust_tier: 'new',
        total_completed_transactions: 0, total_rejections: 0,
        birthday: null, welcomed_at: null,
        first_name: null, last_name: null, marketing_consent_at: null,
      }).in('id', testUserIds);

      // Re-apply the canonical persona roles. Kari is the dedicated
      // moderator persona; Nora is the dedicated admin persona. Tests
      // and the dev UI assume these are always set.
      const kariId = emailToId.get('kari@test.strikketorget.no');
      const noraId = emailToId.get('nora@test.strikketorget.no');
      if (kariId) await db.from('profiles').update({ role: 'moderator' }).eq('id', kariId);
      if (noraId) await db.from('profiles').update({ role: 'admin' }).eq('id', noraId);

      // All notifications for test users
      for (const uid of testUserIds) {
        await db.from('notifications').delete().eq('user_id', uid);
      }

      const total = (testRequests?.length ?? 0) + (testOffers?.length ?? 0) + (testListings?.length ?? 0);
      return { data: { cleaned: true, deleted: total } };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
