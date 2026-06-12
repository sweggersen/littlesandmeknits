import type { SupabaseClient } from '@supabase/supabase-js';
import type { TypedSupabaseClient } from '../supabase';
import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createStripe } from '../stripe';
import { createNotification } from '../notify';
import { VALID_CATEGORIES } from '../labels';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../storage';
import { recordDeadLetter } from './dead-letter';
import { killGuard, isKilled } from '../flags';

const VALID_KIND = new Set(['pre_loved', 'ready_made']);
const VALID_CONDITION = new Set(['som_ny', 'lite_brukt', 'brukt', 'slitt']);

const toIntOrNull = (v: string | undefined | null): number | null => {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function createListing(
  ctx: ServiceContext,
  input: {
    kind: string; title: string; category: string; sizeLabel: string; priceNok: string;
    condition?: string; description?: string; colorway?: string;
    patternSlug?: string; patternExternalTitle?: string;
    sizeAgeMonthsMin?: string; sizeAgeMonthsMax?: string;
    location?: string; shippingInfo?: string;
    storeId?: string;
    shippingOption?: string; canShip?: string; canMeet?: string;
    knittedBy?: string;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!VALID_KIND.has(input.kind)) return fail('bad_input', 'Invalid kind');
  const title = input.title.trim();
  if (!title) return fail('bad_input', 'Title required');
  if (!VALID_CATEGORIES.has(input.category)) return fail('bad_input', 'Invalid category');
  const sizeLabel = input.sizeLabel.trim();
  if (!sizeLabel) return fail('bad_input', 'Size required');
  const priceNok = toIntOrNull(input.priceNok);
  if (priceNok === null) return fail('bad_input', 'Price required');

  let condition: string | null = null;
  if (input.kind === 'pre_loved') {
    if (!input.condition || !VALID_CONDITION.has(input.condition)) {
      return fail('bad_input', 'Condition required for pre-loved');
    }
    condition = input.condition;
  }

  // If selling under a store, verify membership AND that the store is active.
  let storeId: string | null = null;
  if (input.storeId) {
    const { data: member } = await ctx.admin
      .from('store_members')
      .select('role')
      .eq('store_id', input.storeId)
      .eq('user_id', ctx.user.id)
      .maybeSingle();
    if (!member) return fail('forbidden', 'Ikke medlem av denne butikken');
    const { data: store } = await ctx.admin
      .from('stores')
      .select('status, deleted_at')
      .eq('id', input.storeId)
      .maybeSingle();
    if (!store || store.status !== 'active' || store.deleted_at) {
      return fail('conflict', 'Butikken er ikke aktiv ennå');
    }
    storeId = input.storeId;
  }

  // Delivery: shipping and/or local meet, non-exclusive, at least one.
  // Shipping is the only in-app buy path and ALWAYS uses trygg betaling
  // (escrow) — there is no "ship without protection". Meet = off-platform.
  const canShip = input.canShip === 'true';
  const canMeet = input.canMeet === 'true';
  if (!canShip && !canMeet) {
    return fail('bad_input', 'Velg minst ett leveringsalternativ: sending eller henting.');
  }

  let shippingOptionId: string | null = null;
  let shippingPriceNok = 0;
  if (canShip) {
    const { SHIPPING_TIERS } = await import('../shipping');
    const tier = SHIPPING_TIERS.find(t => t.id === input.shippingOption) ?? SHIPPING_TIERS[0];
    shippingOptionId = tier.id;
    shippingPriceNok = tier.priceNok;
  }
  // Shipping implies escrow; stores keep it on too (covered by subscription).
  const escrowEnabled = canShip || !!storeId;

  const { data, error } = await ctx.supabase
    .from('listings')
    .insert({
      seller_id: ctx.user.id, store_id: storeId,
      escrow_enabled: escrowEnabled,
      can_meet: canMeet,
      shipping_option: shippingOptionId as 'free' | 'small_letter' | 'small_parcel' | 'parcel' | null,
      shipping_price_nok: shippingPriceNok,
      // VALID_KIND / VALID_CATEGORIES / VALID_CONDITION above narrow
      // these to the enum values but TS can't carry the narrowing
      // across a Set.has() check. Cast at the insert site.
      kind: input.kind as 'pre_loved' | 'ready_made',
      title,
      description: input.description?.trim() || null,
      price_nok: priceNok, size_label: sizeLabel,
      size_age_months_min: toIntOrNull(input.sizeAgeMonthsMin),
      size_age_months_max: toIntOrNull(input.sizeAgeMonthsMax),
      category: input.category as 'cardigan' | 'lue' | 'bukser' | 'sokker' | 'genser' | 'teppe' | 'votter' | 'kjole' | 'annet',
      condition: condition as 'lite_brukt' | 'brukt' | 'som_ny' | 'slitt' | null,
      pattern_slug: input.patternSlug?.trim() || null,
      pattern_external_title: input.patternExternalTitle?.trim() || null,
      colorway: input.colorway?.trim() || null,
      knitted_by: input.knittedBy?.trim() || null,
      location: input.location?.trim() || null,
      shipping_info: input.shippingInfo?.trim() || null,
      status: 'draft',
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('Listing create failed', error);
    return fail('server_error', 'Could not create listing');
  }

  return ok({ redirect: `/market/listing/${data.id}/foto` });
}

const LISTING_FEE_NOK = 29;

/** Publish a draft listing. Free for everyone. The listing goes to
 *  pending_review (or active for trusted sellers / auto-approved stores).
 *  Stripe is NOT involved at publish time. */
export async function publishListing(
  ctx: ServiceContext,
  input: { listingId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.listingId) return fail('bad_input', 'Missing id');

  const { data: listing } = await ctx.supabase
    .from('listings')
    .select('id, seller_id, status')
    .eq('id', input.listingId)
    .maybeSingle();

  if (!listing || listing.seller_id !== ctx.user.id) return fail('not_found', 'Not found');
  if (listing.status !== 'draft') return ok({ redirect: `/market/listing/${input.listingId}` });

  const { count: photoCount } = await ctx.supabase
    .from('listing_photos').select('*', { count: 'exact', head: true }).eq('listing_id', input.listingId);
  if (!photoCount || photoCount < 1) return fail('bad_input', 'Legg til minst ett bilde før du publiserer');

  const { data: profile } = await ctx.admin
    .from('profiles').select('trust_tier').eq('id', ctx.user.id).maybeSingle();
  const autoApprove = profile?.trust_tier === 'trusted';
  const newStatus = autoApprove ? 'active' : 'pending_review';

  const { error: updateErr } = await ctx.admin
    .from('listings').update({
      status: newStatus,
      published_at: autoApprove ? new Date().toISOString() : null,
    }).eq('id', input.listingId).eq('status', 'draft');
  if (updateErr) {
    console.error('Publish update failed', updateErr);
    return fail('server_error', 'Kunne ikke publisere annonse');
  }

  if (!autoApprove) {
    const { data: queued } = await ctx.admin.from('moderation_queue').insert({
      item_type: 'listing',
      item_id: input.listingId,
      submitter_id: ctx.user.id,
    }).select('id').maybeSingle();

    if (queued) {
      const { data: l } = await ctx.admin.from('listings').select('title').eq('id', input.listingId).maybeSingle();
      const { notifyModeratorsNewItem } = await import('../notify');
      await notifyModeratorsNewItem(ctx.admin, {
        itemType: 'listing',
        itemId: input.listingId,
        queueId: queued.id,
        submitterId: ctx.user.id,
        title: l?.title,
      }, ctx.env);
    }
  } else {
    // Trusted seller publishes straight to active — notify followers now.
    try {
      const [{ data: l }, { data: profile }] = await Promise.all([
        ctx.admin.from('listings').select('title').eq('id', input.listingId).maybeSingle(),
        ctx.admin.from('profiles').select('display_name').eq('id', ctx.user.id).maybeSingle(),
      ]);
      const { notifyFollowersOfNewListing } = await import('../notify');
      await notifyFollowersOfNewListing(ctx.admin, {
        sellerId: ctx.user.id,
        listingId: input.listingId,
        listingTitle: l?.title ?? 'Ny annonse',
        sellerName: profile?.display_name,
      }, ctx.env);
    } catch (err) {
      await recordDeadLetter(ctx, {
        service: 'listings.publishListing:follower-fanout',
        context: { listing_id: input.listingId },
        error: err,
      });
    }
  }

  return ok({ redirect: `/market/listing/${input.listingId}?published=1` });
}

/** Manually mark a non-escrow listing as sold. Used when the seller
 *  arranged payment outside the platform (Vipps, cash, etc.). For escrow
 *  listings the status transitions are driven by the buy/ship/confirm
 *  flow instead. */
export async function markListingSold(
  ctx: ServiceContext,
  input: { listingId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.listingId) return fail('bad_input', 'Missing id');

  const { data: listing } = await ctx.admin
    .from('listings')
    .select('id, seller_id, status, escrow_enabled')
    .eq('id', input.listingId)
    .maybeSingle();
  if (!listing || listing.seller_id !== ctx.user.id) return fail('not_found', 'Not found');
  if (listing.status !== 'active') return fail('bad_input', 'Bare aktive annonser kan markeres som solgt');
  if (listing.escrow_enabled) return fail('bad_input', 'Bruk Trygg betaling-flyten for denne annonsen');

  const now = new Date().toISOString();
  const { error } = await ctx.admin
    .from('listings')
    .update({ status: 'sold', sold_at: now, delivered_at: now })
    .eq('id', input.listingId);
  if (error) return fail('server_error', 'Kunne ikke markere som solgt');

  return ok({ redirect: `/market/listing/${input.listingId}?sold=1` });
}

async function syncHero(supabase: SupabaseClient, listingId: string) {
  const { data: first } = await supabase
    .from('listing_photos').select('path').eq('listing_id', listingId)
    .order('position').limit(1).maybeSingle();
  await supabase.from('listings').update({ hero_photo_path: first?.path ?? null }).eq('id', listingId);
}

export async function deleteListingPhoto(
  ctx: ServiceContext,
  input: { listingId: string; photoId: string },
): Promise<ServiceResult<void>> {
  const { data: photo } = await ctx.supabase
    .from('listing_photos').select('path').eq('id', input.photoId).eq('listing_id', input.listingId).maybeSingle();
  if (photo) {
    await ctx.supabase.storage.from('projects').remove([photo.path]);
    await ctx.supabase.from('listing_photos').delete().eq('id', input.photoId);
    await syncHero(ctx.admin, input.listingId);
  }
  return ok(undefined as void);
}

export async function captionListingPhoto(
  ctx: ServiceContext,
  input: { listingId: string; photoId: string; caption: string },
): Promise<ServiceResult<void>> {
  await ctx.supabase.from('listing_photos')
    .update({ caption: input.caption || null })
    .eq('id', input.photoId).eq('listing_id', input.listingId);
  return ok(undefined as void);
}

export async function reorderListingPhotos(
  ctx: ServiceContext,
  input: { listingId: string; order: string[] },
): Promise<ServiceResult<void>> {
  await Promise.all(
    input.order.map((id, i) =>
      ctx.supabase.from('listing_photos')
        .update({ position: i }).eq('id', id).eq('listing_id', input.listingId),
    ),
  );
  await syncHero(ctx.admin, input.listingId);
  return ok(undefined as void);
}

const MAX_PHOTOS = 6;

export async function uploadListingPhotos(
  ctx: ServiceContext,
  input: { listingId: string; files: File[] },
): Promise<ServiceResult<{ redirect: string }>> {
  if (input.files.length === 0) return ok({ redirect: `/market/listing/${input.listingId}` });

  const { count } = await ctx.supabase
    .from('listing_photos').select('*', { count: 'exact', head: true }).eq('listing_id', input.listingId);
  const slotsLeft = MAX_PHOTOS - (count ?? 0);
  if (slotsLeft <= 0) return fail('bad_input', `Max ${MAX_PHOTOS} photos per listing`);

  const toUpload = input.files.slice(0, slotsLeft);
  for (const file of toUpload) {
    if (file.size > MAX_PHOTO_BYTES) return fail('bad_input', 'Photo too large (max 10 MB)');
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) return fail('bad_input', 'Unsupported file type');
  }

  let position = count ?? 0;
  for (const file of toUpload) {
    const ext = extFromMime(file.type);
    const path = `${ctx.user.id}/listings/${input.listingId}/photo-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await ctx.supabase.storage
      .from('projects').upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) return fail('server_error', 'Upload failed');
    await ctx.supabase.from('listing_photos').insert({ listing_id: input.listingId, path, position });
    position++;
  }

  await syncHero(ctx.admin, input.listingId);
  return ok({ redirect: `/market/listing/${input.listingId}` });
}

const PLATFORM_FEE_PERCENT = 13;
const AMBASSADOR_FEE_PERCENT = 8;

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
  const feeNok = p.amountTotalOre ? Math.round((p.amountTotalOre * 0.13) / 100) : 0;

  const { data: rows, error } = await admin
    .from('listings')
    .update({
      status: 'reserved',
      buyer_id: p.buyerId,
      stripe_payment_intent_id: p.paymentIntentId ?? null,
      platform_fee_nok: feeNok,
      reserved_at: nowIso,
      auto_release_at: autoReleaseAt,
      buyer_name: p.shipping?.name ?? null,
      buyer_address: p.shipping?.line1 ?? null,
      buyer_postal_code: p.shipping?.postalCode ?? null,
      buyer_city: p.shipping?.city ?? null,
    })
    .eq('id', p.listingId)
    .eq('status', 'active')
    .select('seller_id, title');

  if (error) return { updated: false, error, listing: null };
  const listing = (rows?.[0] as { seller_id: string; title: string } | undefined) ?? null;
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

  const { tbFeeForPrice, shippingTier } = await import('../shipping');
  const tbFee = tbFeeForPrice(listing.price_nok);
  // shipping_price_nok was locked at listing time; fall back to the tier
  // default if missing (legacy rows).
  const tierFallback = shippingTier(listing.shipping_option as any);
  const shippingNok = listing.shipping_price_nok ?? tierFallback?.priceNok ?? 0;

  // For store-owned listings, payment routes to the store's Stripe account
  // (NOT the individual member's). The store is the seller of record.
  let payoutAccountId: string | null = null;
  let onboarded = false;
  let feePercent: number;
  if (listing.store_id) {
    const { data: store } = await ctx.admin
      .from('stores')
      .select('stripe_account_id, stripe_onboarded, tier, status')
      .eq('id', listing.store_id)
      .maybeSingle();
    if (!store || store.status !== 'active') return fail('conflict', 'Store not active');
    payoutAccountId = store.stripe_account_id;
    onboarded = !!store.stripe_onboarded;
    // Tier-based commission: Starter +2%, Pro +1%, Elite +0%
    const tierDelta = store.tier === 'elite' ? 0 : store.tier === 'pro' ? 1 : 2;
    feePercent = PLATFORM_FEE_PERCENT + tierDelta;
  } else {
    const [{ data: seller }, { data: sellerConnect }] = await Promise.all([
      ctx.admin.from('profiles').select('role').eq('id', listing.seller_id).maybeSingle(),
      ctx.admin.from('seller_profiles').select('stripe_account_id, stripe_connect_status').eq('id', listing.seller_id).maybeSingle(),
    ]);
    if (!seller) return fail('not_found', 'Seller not found');
    payoutAccountId = sellerConnect?.stripe_account_id ?? null;
    onboarded = sellerConnect?.stripe_connect_status === 'verified';
    feePercent = seller.role === 'ambassador' ? AMBASSADOR_FEE_PERCENT : PLATFORM_FEE_PERCENT;
  }

  if (!onboarded || !payoutAccountId) {
    return fail('conflict', 'Seller has not set up payments');
  }
  const itemOre = listing.price_nok * 100;
  const shippingOre = shippingNok * 100;
  const tbFeeOre = tbFee * 100;
  // Commission applies to the item only, not shipping or TB fee.
  const platformFeeFromItem = Math.round(itemOre * feePercent / 100);
  // TB fee goes 100% to the platform.
  const applicationFeeOre = platformFeeFromItem + tbFeeOre;
  // Shipping is paid by the buyer and passed through to the seller untouched.

  const lineItems = [
    { price_data: { currency: 'nok', unit_amount: itemOre, product_data: { name: listing.title } }, quantity: 1 },
  ];
  if (shippingOre > 0) {
    lineItems.push({ price_data: { currency: 'nok', unit_amount: shippingOre, product_data: { name: `Frakt (${tierFallback?.label ?? 'sending'})` } }, quantity: 1 });
  }
  if (tbFeeOre > 0) {
    lineItems.push({ price_data: { currency: 'nok', unit_amount: tbFeeOre, product_data: { name: 'Trygg betaling' } }, quantity: 1 });
  }

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
      tb_fee_nok: String(tbFee),
      shipping_nok: String(shippingNok),
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
    .select('id, seller_id, buyer_id, title, status')
    .eq('id', input.listingId)
    .maybeSingle();

  if (!listing || listing.seller_id !== ctx.user.id) return fail('not_found', 'Not found');
  if (listing.status !== 'reserved') return fail('conflict', 'Listing not in reserved state');

  // Capture the PaymentIntent now (the seller has shipped). Stripe Connect
  // Custom holds the funds in the seller's pending balance for 7 days
  // before auto-paying out to their kontonummer — disputes within that
  // window are netted against the next payout. The auto_release_at field
  // is set to DELIVERY_WINDOW_DAYS so we can mark the listing 'sold' for
  // status purposes if the buyer doesn't confirm delivery.
  const shippedAt = new Date();
  const autoReleaseAt = new Date(shippedAt.getTime() + DELIVERY_WINDOW_DAYS * 86400_000);

  const { data: listingForCapture } = await ctx.admin
    .from('listings')
    .select('stripe_payment_intent_id')
    .eq('id', input.listingId)
    .maybeSingle();
  const shipPiId = listingForCapture?.stripe_payment_intent_id;
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
      await ctx.admin.from('listings').update({
        status: 'active', buyer_id: null, stripe_payment_intent_id: null,
        reserved_at: null, auto_release_at: null,
        buyer_name: null, buyer_address: null, buyer_postal_code: null, buyer_city: null,
      }).eq('id', input.listingId).eq('status', 'reserved');
      return fail('conflict', 'Reservasjonen har utløpt og betalingen er ikke lenger gyldig. Annonsen er lagt ut igjen.');
    }
  }

  await ctx.admin
    .from('listings')
    .update({
      status: 'shipped',
      shipped_at: shippedAt.toISOString(),
      tracking_code: input.trackingCode.trim() || null,
      auto_release_at: autoReleaseAt.toISOString(),
    })
    .eq('id', input.listingId);

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
    .select('id, seller_id, buyer_id, title, status, stripe_payment_intent_id')
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

  if (listing.stripe_payment_intent_id) {
    const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);
    // The PI is often already captured (we capture at ship time). Capturing an
    // already-captured or canceled PI throws, so branch on its state:
    //  - requires_capture → capture now (buyer confirmed before/without ship)
    //  - succeeded        → already captured at ship; nothing to do
    //  - anything else    → auth expired/canceled; money was never collected,
    //                       so DON'T mark sold — dead-letter for support.
    const pi = await stripe.paymentIntents.retrieve(listing.stripe_payment_intent_id);
    if (pi.status === 'requires_capture') {
      await stripe.paymentIntents.capture(listing.stripe_payment_intent_id);
    } else if (pi.status !== 'succeeded') {
      await recordDeadLetter(ctx, {
        service: 'listings.confirmListingDelivery:not-capturable',
        context: { listing_id: input.listingId, payment_intent_id: listing.stripe_payment_intent_id, pi_status: pi.status },
        error: `PaymentIntent not capturable (status=${pi.status})`,
      });
      return fail('conflict', 'Betalingen kunne ikke fullføres. Ta kontakt med support.');
    }
  }

  const now = new Date().toISOString();
  await ctx.admin
    .from('listings')
    .update({
      status: 'sold',
      sold_at: now,
      delivered_at: now,
      auto_release_at: null,
    })
    .eq('id', input.listingId);

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
    .select('id, seller_id, buyer_id, title, status, stripe_payment_intent_id')
    .eq('id', input.listingId)
    .maybeSingle();
  if (!listing || listing.status !== 'reserved') return { released: false };

  if (listing.stripe_payment_intent_id) {
    const stripe = createStripe(env.STRIPE_SECRET_KEY);
    const pi = await stripe.paymentIntents.retrieve(listing.stripe_payment_intent_id);
    // Cancel a still-uncaptured auth to release the buyer's hold. If it's
    // already canceled (auth expired naturally) there's nothing to release —
    // fall through and revert the row. If it somehow captured/processing, do
    // NOT silently revert (that would lose money) — dead-letter and bail.
    if (pi.status === 'requires_capture' || pi.status === 'requires_payment_method'
        || pi.status === 'requires_confirmation' || pi.status === 'requires_action') {
      await stripe.paymentIntents.cancel(listing.stripe_payment_intent_id);
    } else if (pi.status !== 'canceled') {
      await recordDeadLetter({ admin, user: listing.buyer_id ? { id: listing.buyer_id } : undefined }, {
        service: 'listings.releaseExpiredReservation:not-cancelable',
        context: { listing_id: listing.id, payment_intent_id: listing.stripe_payment_intent_id, pi_status: pi.status, reason: input.reason },
        error: `Refusing to release a non-cancelable PaymentIntent (status=${pi.status})`,
      });
      return { released: false };
    }
  }

  // Revert to active so it can be bought again; clear the purchase trail. The
  // status guard keeps this idempotent against a cron/webhook double-fire.
  const { data: reverted } = await admin
    .from('listings')
    .update({
      status: 'active', buyer_id: null, stripe_payment_intent_id: null,
      reserved_at: null, auto_release_at: null,
      buyer_name: null, buyer_address: null, buyer_postal_code: null, buyer_city: null,
    })
    .eq('id', input.listingId)
    .eq('status', 'reserved')
    .select('id');
  if (!reverted?.length) return { released: false }; // a concurrent caller won the race

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
    .select('id, seller_id, buyer_id, title, status, auto_release_at')
    .eq('id', input.listingId)
    .maybeSingle();

  if (!listing || listing.buyer_id !== ctx.user.id) return fail('not_found', 'Not found');
  if (listing.status !== 'reserved' && listing.status !== 'shipped') {
    return fail('conflict', 'Cannot dispute in this state');
  }

  await ctx.admin
    .from('listings')
    .update({
      status: 'disputed',
      disputed_at: new Date().toISOString(),
      dispute_reason: reason,
      auto_release_at: null,
    })
    .eq('id', input.listingId);

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
