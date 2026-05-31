import type { SupabaseClient } from '@supabase/supabase-js';
import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createStripe } from '../stripe';
import { createNotification } from '../notify';
import { VALID_CATEGORIES } from '../labels';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../storage';
import { recordDeadLetter } from './dead-letter';

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
    shippingOption?: string; escrowEnabled?: string;
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

  // Trygg betaling is now free. Default ON for stores (their subscription
  // covers it) and ON for personal sellers when they explicitly tick the
  // box on step 2 of the wizard.
  const escrowEnabled = !!storeId || input.escrowEnabled === 'true';

  // Shipping option locked at listing time. Falls back to 'free' for
  // anything weird so the schema CHECK constraint is satisfied.
  const { SHIPPING_TIERS } = await import('../shipping');
  const tier = SHIPPING_TIERS.find(t => t.id === input.shippingOption) ?? SHIPPING_TIERS[0];

  const { data, error } = await ctx.supabase
    .from('listings')
    .insert({
      seller_id: ctx.user.id, store_id: storeId,
      escrow_enabled: escrowEnabled,
      shipping_option: tier.id,
      shipping_price_nok: tier.priceNok,
      kind: input.kind, title, description: input.description?.trim() || null,
      price_nok: priceNok, size_label: sizeLabel,
      size_age_months_min: toIntOrNull(input.sizeAgeMonthsMin),
      size_age_months_max: toIntOrNull(input.sizeAgeMonthsMax),
      category: input.category, condition,
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

/** Toggle Trygg betaling on/off for a listing.
 *  Now free for the seller — the buyer pays a small TB fee at checkout. */
export async function toggleListingEscrow(
  ctx: ServiceContext,
  input: { listingId: string; enabled: boolean },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.listingId) return fail('bad_input', 'Missing id');

  const { data: listing } = await ctx.admin
    .from('listings')
    .select('id, seller_id, status')
    .eq('id', input.listingId)
    .maybeSingle();

  if (!listing || listing.seller_id !== ctx.user.id) return fail('not_found', 'Not found');

  await ctx.admin
    .from('listings')
    .update({ escrow_enabled: !!input.enabled })
    .eq('id', input.listingId);

  return ok({ redirect: `/market/listing/${input.listingId}?tb=${input.enabled ? 'on' : 'off'}` });
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

export async function purchaseListing(
  ctx: ServiceContext,
  input: { listingId: string; stripeSecretKey: string },
): Promise<ServiceResult<{ checkoutUrl: string }>> {
  if (!input.listingId) return fail('bad_input', 'Missing listing ID');
  if (!input.stripeSecretKey) return fail('server_error', 'Stripe not configured');

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
    const { data: seller } = await ctx.admin
      .from('profiles')
      .select('stripe_account_id, stripe_onboarded, role')
      .eq('id', listing.seller_id)
      .maybeSingle();
    if (!seller) return fail('not_found', 'Seller not found');
    payoutAccountId = seller.stripe_account_id;
    onboarded = !!seller.stripe_onboarded;
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
    // 'vipps' became available as a Stripe Checkout payment method in NO.
    payment_method_types: ['vipps', 'card'],
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
  // is still set to 14 days so we can mark the listing 'sold' for status
  // purposes if the buyer doesn't confirm delivery.
  const shippedAt = new Date();
  const autoReleaseAt = new Date(shippedAt.getTime() + 14 * 86400_000);

  const { data: listingForCapture } = await ctx.admin
    .from('listings')
    .select('stripe_payment_intent_id')
    .eq('id', input.listingId)
    .maybeSingle();
  if (listingForCapture?.stripe_payment_intent_id) {
    try {
      const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);
      await stripe.paymentIntents.capture(listingForCapture.stripe_payment_intent_id);
    } catch (e) {
      // Fall through — the auto_release_at cron will retry on day 14.
      // Land in dead-letter so support sees it before the retry window.
      await recordDeadLetter(ctx, {
        service: 'listings.shipListing:capture-on-ship',
        context: {
          listing_id: input.listingId,
          payment_intent_id: listingForCapture.stripe_payment_intent_id,
        },
        error: e,
      });
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

  if (listing.stripe_payment_intent_id) {
    const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);
    await stripe.paymentIntents.capture(listing.stripe_payment_intent_id);
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
