import type { SupabaseClient } from '@supabase/supabase-js';
import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
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

  // Manual "Kan møtes" sale — no order (paid off-platform), just the catalog status.
  const now = new Date().toISOString();
  const { error } = await ctx.admin
    .from('listings')
    .update({ status: 'sold', sold_at: now })
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

// ── Escrow / money path ────────────────────────────────────────────────
// Moved to listings-escrow.ts (staff review P2.4) so the mutation gate targets
// that file as a whole. Re-exported here so importers keep using
// `services/listings` unchanged.
export {
  completeListingPurchase,
  purchaseListing,
  shipListing,
  confirmListingDelivery,
  releaseExpiredReservation,
  disputeListing,
} from './listings-escrow';
export type { CompletePurchaseParams, CompletePurchaseResult } from './listings-escrow';
