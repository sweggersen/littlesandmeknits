// Listing escrow / money path — extracted from listings.ts so the mutation
// gate can target this whole file instead of brittle line ranges (staff
// review P2.4). Catalog CRUD stays in listings.ts; these are the functions
// that move money (Stripe manual-capture escrow, capture-at-ship, auto-release,
// refunds, disputes) + write the orders source-of-truth + payment_events
// ledger. No coupling back to catalog functions — clean split.
//
// listings.ts re-exports these, so existing importers are unaffected.

import type { TypedSupabaseClient } from '../supabase';
import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createStripe } from '../stripe';
import { createNotification } from '../notify';
import { recordDeadLetter } from './dead-letter';
import { killGuard, isKilled } from '../flags';
import { createReservedOrder, updateOpenOrder, findOpenOrder } from './orders';
import { recordPaymentEvent } from './payment-events';

// Escrow timing. Stripe manual-capture authorizations expire ~7 days after the
// charge, so a reservation MUST resolve before then. SHIP_DEADLINE_DAYS is the
// window the seller has to ship (well inside 7d); past it the cron releases the
// reservation (cancels the hold, relists) rather than capturing money for an
// item that never shipped. DELIVERY_WINDOW_DAYS is the post-ship window for the
// buyer to confirm before auto-release — capture already happened at ship, so
// this one is just a status deadline and may exceed 7 days safely.
const SHIP_DEADLINE_DAYS = 5;
const DELIVERY_WINDOW_DAYS = 14;

export interface CompletePurchaseParams {
  listingId: string;
  buyerId: string;
  /** PaymentIntent id from the completed Checkout session, if any. */
  paymentIntentId: string | null;
  /** session.amount_total in ore (what the buyer paid, all line items). */
  amountTotalOre: number | null;
  /** Exact application_fee_amount in ore, echoed via session metadata
   *  (platform_fee_ore). Null for sessions created before the metadata was
   *  added — those fall back to the legacy 13%-of-total estimate. */
  platformFeeOre?: number | null;
  /** TB fee + shipping (NOK), from session metadata — recorded on the order's
   *  money breakdown. Default 0 for legacy sessions. */
  tbFeeNok?: number | null;
  shippingNok?: number | null;
  /** Shipping address collected at Checkout. */
  shipping?: {
    name?: string | null;
    line1?: string | null;
    postalCode?: string | null;
    city?: string | null;
  } | null;
  /** Injectable clock for deterministic tests. Defaults to now. */
  now?: Date;
}

export interface CompletePurchaseResult {
  /** True only if a row actually transitioned active -> reserved. False on a
   *  duplicate Stripe delivery (status already moved) or a missing listing. */
  updated: boolean;
  error: unknown;
  /** The reserved listing (seller_id, title) for notification, when updated. */
  listing: { seller_id: string; title: string } | null;
}

/** Apply the escrow purchase transition: active -> reserved, recording the
 *  buyer, PaymentIntent, platform fee and shipping address. Extracted from the
 *  Stripe webhook so the money-state transition is independently testable
 *  (against real Postgres) and goes through the service layer like every other
 *  write.
 *
 *  Idempotent by construction: the update is guarded on `status = 'active'`,
 *  and `.select()` tells us whether a row matched. A Stripe retry that arrives
 *  after the first delivery finds status already 'reserved', matches nothing,
 *  and returns `updated: false` — so the caller skips the duplicate
 *  "your item sold" notification. */
export async function completeListingPurchase(
  admin: TypedSupabaseClient,
  p: CompletePurchaseParams,
): Promise<CompletePurchaseResult> {
  const now = (p.now ?? new Date());
  const nowIso = now.toISOString();
  // Ship-by deadline: the seller must ship within SHIP_DEADLINE_DAYS (safely
  // under Stripe's 7-day auth expiry). Past it, the cron RELEASES the
  // reservation (cancel hold + relist) instead of capturing. shipListing
  // recomputes this to shipped_at + DELIVERY_WINDOW_DAYS once shipped.
  const autoReleaseAt = new Date(now.getTime() + SHIP_DEADLINE_DAYS * 86400_000).toISOString();
  // Prefer the exact fee Stripe charged (echoed through session metadata);
  // the 13%-of-total fallback only covers sessions created before the
  // metadata existed and is wrong for ambassador/store rates + the TB fee.
  const feeNok = p.platformFeeOre != null
    ? Math.round(p.platformFeeOre / 100)
    : p.amountTotalOre ? Math.round((p.amountTotalOre * 0.13) / 100) : 0;

  // The listing carries only the catalog projection (status + current holder);
  // the order (below) is the sole home of money, PII and lifecycle.
  const { data: rows, error } = await admin
    .from('listings')
    .update({ status: 'reserved', buyer_id: p.buyerId })
    .eq('id', p.listingId)
    .eq('status', 'active')
    .select('seller_id, title, price_nok, store_id');

  if (error) return { updated: false, error, listing: null };
  const listing = (rows?.[0] as { seller_id: string; title: string; price_nok: number; store_id: string | null } | undefined) ?? null;

  // Record the order (source of truth). Only on a real transition (not a
  // duplicate webhook delivery, which matches 0 rows).
  if (listing) {
    let orderId: string | null;
    try {
      orderId = await createReservedOrder(admin, {
        listing_id: p.listingId,
        buyer_id: p.buyerId,
        seller_id: listing.seller_id,
        store_id: listing.store_id ?? null,
        status: 'reserved',
        item_price_nok: listing.price_nok,
        shipping_nok: p.shippingNok ?? 0,
        tb_fee_nok: p.tbFeeNok ?? 0,
        platform_fee_nok: feeNok,
        stripe_payment_intent_id: p.paymentIntentId ?? null,
        shipping_name: p.shipping?.name ?? null,
        shipping_address: p.shipping?.line1 ?? null,
        shipping_postal_code: p.shipping?.postalCode ?? null,
        shipping_city: p.shipping?.city ?? null,
        reserved_at: nowIso,
        ship_deadline_at: autoReleaseAt,
      });
    } catch (e) {
      // Atomicity: the listing was flipped to 'reserved' above, but the order
      // (source of truth for the buyer's paid purchase) failed to insert.
      // Compensate by reverting the flip so the row isn't stranded as
      // 'reserved' with no order, then rethrow — the webhook dead-letters +
      // 500s, Stripe redelivers, and the (now-'active') listing reprocesses
      // cleanly. createReservedOrder is idempotent (partial unique index), so
      // the retry is safe even if the order did land before the failure.
      await admin
        .from('listings')
        .update({ status: 'active', buyer_id: null })
        .eq('id', p.listingId)
        .eq('status', 'reserved');
      throw e;
    }
    // Ledger: funds authorized & held. amount = item + shipping (what the
    // buyer paid that's in escrow); fee = the platform's cut (TB fee).
    await recordPaymentEvent(admin, {
      kind: 'listing', type: 'reserved', orderId, actorId: p.buyerId,
      amountNok: listing.price_nok + (p.shippingNok ?? 0), feeNok,
      paymentIntentId: p.paymentIntentId ?? null,
    });
  }

  return { updated: !!listing, error: null, listing };
}

export async function purchaseListing(
  ctx: ServiceContext,
  input: { listingId: string; stripeSecretKey: string },
): Promise<ServiceResult<{ checkoutUrl: string }>> {
  if (!input.listingId) return fail('bad_input', 'Missing listing ID');
  if (!input.stripeSecretKey) return fail('server_error', 'Stripe not configured');
  const blocked = await killGuard(['purchases'], ctx.env);
  if (blocked) return blocked;

  const { data: listing } = await ctx.supabase
    .from('listings')
    .select('id, seller_id, store_id, title, price_nok, status, hero_photo_path, escrow_enabled, shipping_option, shipping_price_nok')
    .eq('id', input.listingId)
    .maybeSingle();

  if (!listing) return fail('not_found', 'Listing not found');
  if (listing.status !== 'active') return fail('conflict', 'Listing not available');
  if (listing.seller_id === ctx.user.id) return fail('bad_input', 'Cannot buy own listing');
  if (!listing.escrow_enabled) return fail('conflict', 'Selger har ikke aktivert trygg betaling på denne annonsen — kontakt selger direkte');

  const { shippingTier } = await import('../shipping');
  const { MoneyBreakdown } = await import('../money');
  // shipping_price_nok was locked at listing time; fall back to the tier
  // default if missing (legacy rows).
  const tierFallback = shippingTier(listing.shipping_option as any);
  const shippingNok = listing.shipping_price_nok ?? tierFallback?.priceNok ?? 0;

  // For store-owned listings, payment routes to the store's Stripe account
  // (NOT the individual member's). The store is the seller of record.
  let payoutAccountId: string | null = null;
  let onboarded = false;
  if (listing.store_id) {
    const { data: store } = await ctx.admin
      .from('stores')
      .select('stripe_account_id, stripe_onboarded, status')
      .eq('id', listing.store_id)
      .maybeSingle();
    if (!store || store.status !== 'active') return fail('conflict', 'Store not active');
    payoutAccountId = store.stripe_account_id;
    onboarded = !!store.stripe_onboarded;
  } else {
    const { data: sellerConnect } = await ctx.admin
      .from('seller_profiles')
      .select('stripe_account_id, stripe_connect_status')
      .eq('id', listing.seller_id)
      .maybeSingle();
    payoutAccountId = sellerConnect?.stripe_account_id ?? null;
    onboarded = sellerConnect?.stripe_connect_status === 'verified';
  }

  if (!onboarded || !payoutAccountId) {
    return fail('conflict', 'Seller has not set up payments');
  }
  // ALL money math for a listing sale is assembled + validated by the money
  // authority. H4 launch fee model: NO commission on the item — the platform's
  // revenue is the buyer-paid TB fee only; item + shipping pass through to the
  // seller (the Stripe application fee on this destination charge = the TB fee).
  const money = MoneyBreakdown.listingPurchase({ priceNok: listing.price_nok, shippingNok });
  const applicationFeeOre = money.applicationFeeOre;

  const lineItems = money
    .lineItems({ item: listing.title, shipping: `Frakt (${tierFallback?.label ?? 'sending'})`, fee: 'Trygg betaling' })
    .map((li) => ({ price_data: { currency: 'nok' as const, unit_amount: li.amountOre, product_data: { name: li.name } }, quantity: 1 }));

  const siteUrl = ctx.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  const stripe = createStripe(input.stripeSecretKey);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    // Vipps is the Norwegian default; card + Apple Pay cover everyone else.
    // 'vipps' became available as a Stripe Checkout payment method in
    // NO. Stripe's TS types lag the API by months; cast at call site.
    payment_method_types: ['vipps' as 'card', 'card'],
    shipping_address_collection: { allowed_countries: ['NO'] },
    payment_intent_data: {
      capture_method: 'manual',
      application_fee_amount: applicationFeeOre,
      transfer_data: { destination: payoutAccountId },
    },
    success_url: `${siteUrl}/market/listing/${input.listingId}?purchased=1`,
    cancel_url: `${siteUrl}/market/listing/${input.listingId}`,
    customer_email: ctx.user.email ?? undefined,
    client_reference_id: ctx.user.id,
    metadata: {
      type: 'listing_purchase',
      listing_id: input.listingId,
      buyer_id: ctx.user.id,
      seller_id: listing.seller_id,
      tb_fee_nok: String(money.platformFeeOre / 100),
      shipping_nok: String(shippingNok),
      // Exact application fee, echoed back by the webhook so the recorded
      // platform_fee_nok matches what Stripe actually charged (H3) — the
      // percent varies (standard/ambassador/store tier) and the TB fee is
      // 100% ours, so no recomputation from the session total can be right.
      platform_fee_ore: String(applicationFeeOre),
      store_id: listing.store_id ?? '',
    },
    locale: 'nb',
  });

  if (!session.url) return fail('server_error', 'Checkout URL missing');
  return ok({ checkoutUrl: session.url });
}

export async function shipListing(
  ctx: ServiceContext,
  input: { listingId: string; trackingCode: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.listingId) return fail('bad_input', 'Missing listing ID');

  const { data: listing } = await ctx.supabase
    .from('listings')
    .select('id, seller_id, buyer_id, title, status, shipping_option')
    .eq('id', input.listingId)
    .maybeSingle();

  if (!listing || listing.seller_id !== ctx.user.id) return fail('not_found', 'Not found');
  if (listing.status !== 'reserved') return fail('conflict', 'Listing not in reserved state');

  // Fraud control (P0.2): a tracked parcel MUST ship with a tracking number —
  // it's the evidence that defeats a false "didn't receive it" claim (and wins
  // the chargeback). Untracked tiers (brev/free) can't provide one.
  const { isTrackedTier } = await import('../shipping');
  if (isTrackedTier(listing.shipping_option as never) && !input.trackingCode.trim()) {
    return fail('bad_input', 'Legg inn sporingsnummeret fra Posten før du markerer som sendt.');
  }

  // Capture the PaymentIntent now (the seller has shipped). Stripe Connect
  // Custom holds the funds in the seller's pending balance for 7 days
  // before auto-paying out to their kontonummer — disputes within that
  // window are netted against the next payout. The auto_release_at field
  // is set to DELIVERY_WINDOW_DAYS so we can mark the listing 'sold' for
  // status purposes if the buyer doesn't confirm delivery.
  const shippedAt = new Date();
  const autoReleaseAt = new Date(shippedAt.getTime() + DELIVERY_WINDOW_DAYS * 86400_000);

  // The PaymentIntent lives on the order (source of truth) now.
  const order = await findOpenOrder(ctx.admin, input.listingId);
  const shipPiId = order?.stripe_payment_intent_id;
  // Skip the capture entirely while payouts are paused — marking shipped is
  // fine, and the auto-release cron (which also honours the switch) captures
  // once payouts resume (still inside the ~7-day auth window, since the
  // ship-by deadline is < 7 days).
  if (shipPiId && !(await isKilled('payouts', ctx.env))) {
    const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);
    // The manual-capture auth expires ~7 days after purchase. Branch on the
    // live PI state so a seller never ships against money we can't collect:
    //  - requires_capture → capture now
    //  - succeeded        → already captured (rare pre-ship); proceed
    //  - anything else    → auth expired/canceled. DON'T mark shipped against
    //                       dead money — release the reservation back to active
    //                       and tell the seller (transient Stripe errors throw
    //                       here so the seller simply retries while the auth is
    //                       still alive, rather than shipping for free).
    const pi = await stripe.paymentIntents.retrieve(shipPiId);
    if (pi.status === 'requires_capture') {
      await stripe.paymentIntents.capture(shipPiId);
    } else if (pi.status !== 'succeeded') {
      await recordDeadLetter(ctx, {
        service: 'listings.shipListing:auth-expired',
        context: { listing_id: input.listingId, payment_intent_id: shipPiId, pi_status: pi.status },
        error: `PaymentIntent not capturable at ship (status=${pi.status})`,
      });
      // The order is cancelled (dead auth); the listing returns to the catalog.
      await updateOpenOrder(ctx.admin, input.listingId, {
        status: 'cancelled', cancelled_at: shippedAt.toISOString(), cancel_reason: 'auth_canceled',
      });
      await ctx.admin.from('listings').update({ status: 'active', buyer_id: null })
        .eq('id', input.listingId).eq('status', 'reserved');
      return fail('conflict', 'Reservasjonen har utløpt og betalingen er ikke lenger gyldig. Annonsen er lagt ut igjen.');
    }
  }

  // The order owns the ship lifecycle; the listing carries only the catalog
  // status projection. The delivery-window deadline lives on the order.
  const orderId = await updateOpenOrder(ctx.admin, input.listingId, {
    status: 'shipped',
    shipped_at: shippedAt.toISOString(),
    tracking_code: input.trackingCode.trim() || null,
    auto_release_at: autoReleaseAt.toISOString(),
    ship_deadline_at: null,
  });
  await ctx.admin.from('listings').update({ status: 'shipped' }).eq('id', input.listingId);
  // Ledger: funds captured at ship (the manual-capture hold is now collected).
  await recordPaymentEvent(ctx.admin, {
    kind: 'listing', type: 'captured', orderId, actorId: ctx.user.id,
    amountNok: order?.item_price_nok ?? null, feeNok: order?.platform_fee_nok ?? null,
    paymentIntentId: shipPiId ?? null,
  });

  if (listing.buyer_id) {
    await createNotification(ctx.admin, {
      userId: listing.buyer_id,
      type: 'listing_shipped',
      title: 'Varen er sendt!',
      body: `«${listing.title}» er på vei til deg.`,
      url: `/market/listing/${input.listingId}`,
      actorId: ctx.user.id,
      referenceId: input.listingId,
    }, ctx.env);
  }

  return ok({ redirect: `/market/listing/${input.listingId}` });
}

export async function confirmListingDelivery(
  ctx: ServiceContext,
  input: { listingId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.listingId) return fail('bad_input', 'Missing listing ID');

  const { data: listing } = await ctx.admin
    .from('listings')
    .select('id, seller_id, buyer_id, title, status')
    .eq('id', input.listingId)
    .maybeSingle();

  if (!listing || listing.buyer_id !== ctx.user.id) return fail('not_found', 'Not found');
  if (listing.status !== 'reserved' && listing.status !== 'shipped') {
    return fail('conflict', 'Cannot confirm delivery in this state');
  }
  // Capturing here releases escrow to the seller. If payouts are paused, bail
  // BEFORE touching listing state so the buyer can confirm again later — never
  // mark sold without having captured.
  const payoutsBlocked = await killGuard(['payouts'], ctx.env);
  if (payoutsBlocked) return payoutsBlocked;

  const order = await findOpenOrder(ctx.admin, input.listingId);
  const piId = order?.stripe_payment_intent_id;
  if (piId) {
    const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);
    // The PI is often already captured (we capture at ship time). Capturing an
    // already-captured or canceled PI throws, so branch on its state:
    //  - requires_capture → capture now (buyer confirmed before/without ship)
    //  - succeeded        → already captured at ship; nothing to do
    //  - anything else    → auth expired/canceled; money was never collected,
    //                       so DON'T mark sold — dead-letter for support.
    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.status === 'requires_capture') {
      await stripe.paymentIntents.capture(piId);
    } else if (pi.status !== 'succeeded') {
      await recordDeadLetter(ctx, {
        service: 'listings.confirmListingDelivery:not-capturable',
        context: { listing_id: input.listingId, payment_intent_id: piId, pi_status: pi.status },
        error: `PaymentIntent not capturable (status=${pi.status})`,
      });
      return fail('conflict', 'Betalingen kunne ikke fullføres. Ta kontakt med support.');
    }
  }

  const now = new Date().toISOString();
  // Order is delivered (terminal, money with the seller); listing reflects the
  // sale in its catalog status + sold_at (display).
  const orderId = await updateOpenOrder(ctx.admin, input.listingId, {
    status: 'delivered', delivered_at: now, auto_release_at: null,
  });
  await ctx.admin.from('listings').update({ status: 'sold', sold_at: now }).eq('id', input.listingId);
  // Ledger: escrow released to the seller (terminal success).
  await recordPaymentEvent(ctx.admin, {
    kind: 'listing', type: 'released', orderId, actorId: ctx.user.id,
    amountNok: order?.item_price_nok ?? null, feeNok: order?.platform_fee_nok ?? null,
    paymentIntentId: piId ?? null, context: { trigger: 'buyer_confirmed' },
  });

  if (listing.seller_id) {
    await createNotification(ctx.admin, {
      userId: listing.seller_id,
      type: 'listing_delivered',
      title: 'Levering bekreftet!',
      body: `Kjøper har bekreftet mottak av «${listing.title}». Betalingen frigis.`,
      url: `/market/listing/${input.listingId}`,
      actorId: ctx.user.id,
      referenceId: input.listingId,
    }, ctx.env);
  }

  return ok({ redirect: `/market/listing/${input.listingId}` });
}

/** Release a reserved-but-never-shipped listing whose ship-by deadline passed
 *  (cron) or whose Stripe auth was canceled (webhook). Cancels the still-
 *  uncaptured PaymentIntent to return the buyer's hold, reverts the listing to
 *  'active', clears the purchase trail, and notifies both parties. Idempotent:
 *  acts only while the listing is still 'reserved', so a cron/webhook race is a
 *  safe no-op. NEVER reverts a captured charge (that would silently lose
 *  money) — it dead-letters instead. */
export async function releaseExpiredReservation(
  admin: TypedSupabaseClient,
  env: { STRIPE_SECRET_KEY: string } & Parameters<typeof createNotification>[2],
  input: { listingId: string; reason: 'ship_deadline' | 'auth_canceled' },
): Promise<{ released: boolean }> {
  const { data: listing } = await admin
    .from('listings')
    .select('id, seller_id, buyer_id, title, status')
    .eq('id', input.listingId)
    .maybeSingle();
  if (!listing || listing.status !== 'reserved') return { released: false };

  const order = await findOpenOrder(admin, input.listingId);
  const piId = order?.stripe_payment_intent_id;
  if (piId) {
    const stripe = createStripe(env.STRIPE_SECRET_KEY);
    const pi = await stripe.paymentIntents.retrieve(piId);
    // Cancel a still-uncaptured auth to release the buyer's hold. If it's
    // already canceled (auth expired naturally) there's nothing to release —
    // fall through and revert the row. If it somehow captured/processing, do
    // NOT silently revert (that would lose money) — dead-letter and bail.
    if (pi.status === 'requires_capture' || pi.status === 'requires_payment_method'
        || pi.status === 'requires_confirmation' || pi.status === 'requires_action') {
      await stripe.paymentIntents.cancel(piId);
    } else if (pi.status !== 'canceled') {
      await recordDeadLetter({ admin, env, user: listing.buyer_id ? { id: listing.buyer_id } : undefined }, {
        service: 'listings.releaseExpiredReservation:not-cancelable',
        context: { listing_id: listing.id, payment_intent_id: piId, pi_status: pi.status, reason: input.reason },
        error: `Refusing to release a non-cancelable PaymentIntent (status=${pi.status})`,
      });
      return { released: false };
    }
  }

  // Revert the catalog row to active (status guard keeps this idempotent
  // against a cron/webhook double-fire); the order keeps the cancelled record.
  const { data: reverted } = await admin
    .from('listings')
    .update({ status: 'active', buyer_id: null })
    .eq('id', input.listingId)
    .eq('status', 'reserved')
    .select('id');
  if (!reverted?.length) return { released: false }; // a concurrent caller won the race

  const orderId = await updateOpenOrder(admin, input.listingId, {
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancel_reason: input.reason,
  });
  // Ledger: authorization voided without capture — buyer never charged.
  await recordPaymentEvent(admin, {
    kind: 'listing', type: 'cancelled', orderId,
    actorId: listing.buyer_id ?? null,
    amountNok: order?.item_price_nok ?? null,
    paymentIntentId: piId ?? null, context: { reason: input.reason },
  });

  if (listing.buyer_id) {
    await createNotification(admin, {
      userId: listing.buyer_id,
      type: 'listing_reservation_released',
      title: 'Reservasjonen er opphevet',
      body: `Reservasjonen av «${listing.title}» er opphevet, og du er ikke belastet. Varen er tilgjengelig igjen.`,
      url: `/market/listing/${listing.id}`,
      referenceId: listing.id,
    }, env);
  }
  if (listing.seller_id) {
    await createNotification(admin, {
      userId: listing.seller_id,
      type: 'listing_reservation_released',
      title: 'Reservasjonen utløp',
      body: input.reason === 'auth_canceled'
        ? `Betalingen for «${listing.title}» utløp før varen ble sendt. Reservasjonen er opphevet og annonsen er lagt ut igjen.`
        : `«${listing.title}» ble ikke sendt innen fristen. Reservasjonen er opphevet og annonsen er lagt ut igjen.`,
      url: `/market/listing/${listing.id}`,
      referenceId: listing.id,
    }, env);
  }

  return { released: true };
}

export async function disputeListing(
  ctx: ServiceContext,
  input: { listingId: string; reason: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.listingId) return fail('bad_input', 'Missing listing ID');
  const reason = input.reason.trim();
  if (!reason) return fail('bad_input', 'Reason required');

  const { data: listing } = await ctx.admin
    .from('listings')
    .select('id, seller_id, buyer_id, title, status')
    .eq('id', input.listingId)
    .maybeSingle();

  if (!listing || listing.buyer_id !== ctx.user.id) return fail('not_found', 'Not found');
  if (listing.status !== 'reserved' && listing.status !== 'shipped') {
    return fail('conflict', 'Cannot dispute in this state');
  }

  // The order holds the dispute detail; the listing carries the status mirror.
  const orderId = await updateOpenOrder(ctx.admin, input.listingId, {
    status: 'disputed',
    disputed_at: new Date().toISOString(),
    dispute_reason: reason,
    auto_release_at: null,
  });
  await ctx.admin.from('listings').update({ status: 'disputed' }).eq('id', input.listingId);
  // Ledger: buyer opened a dispute — escrow frozen pending resolution.
  await recordPaymentEvent(ctx.admin, {
    kind: 'listing', type: 'dispute_opened', orderId, actorId: ctx.user.id,
    context: { reason },
  });

  if (listing.seller_id) {
    await createNotification(ctx.admin, {
      userId: listing.seller_id,
      type: 'dispute_opened',
      title: 'Tvist åpnet',
      body: `Kjøper har rapportert et problem med «${listing.title}».`,
      url: `/market/listing/${input.listingId}`,
      actorId: ctx.user.id,
      referenceId: input.listingId,
    }, ctx.env);
  }

  const { data: admins } = await ctx.admin.from('profiles').select('id').eq('role', 'admin');
  for (const a of admins ?? []) {
    await createNotification(ctx.admin, {
      userId: a.id,
      type: 'dispute_opened',
      title: 'Ny tvist',
      body: `Tvist på «${listing.title}» — krever gjennomgang.`,
      url: '/admin/disputes',
      referenceId: input.listingId,
    }, ctx.env);
  }

  return ok({ redirect: `/market/listing/${input.listingId}` });
}
