import type { SupabaseClient } from '@supabase/supabase-js';
import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createStripe } from '../stripe';
import { VALID_CATEGORIES } from '../labels';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../storage';

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

  const { data, error } = await ctx.supabase
    .from('listings')
    .insert({
      seller_id: ctx.user.id, kind: input.kind, title, description: input.description?.trim() || null,
      price_nok: priceNok, size_label: sizeLabel,
      size_age_months_min: toIntOrNull(input.sizeAgeMonthsMin),
      size_age_months_max: toIntOrNull(input.sizeAgeMonthsMax),
      category: input.category, condition,
      pattern_slug: input.patternSlug?.trim() || null,
      pattern_external_title: input.patternExternalTitle?.trim() || null,
      colorway: input.colorway?.trim() || null,
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

  return ok({ redirect: `/marked/listing/${data.id}` });
}

const LISTING_FEE_NOK = 29;

export async function publishListing(
  ctx: ServiceContext,
  input: { listingId: string; stripeSecretKey: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.listingId) return fail('bad_input', 'Missing id');
  if (!input.stripeSecretKey) return fail('server_error', 'Stripe not configured');

  const { data: listing } = await ctx.supabase
    .from('listings')
    .select('id, seller_id, title, status')
    .eq('id', input.listingId)
    .maybeSingle();

  if (!listing || listing.seller_id !== ctx.user.id) return fail('not_found', 'Not found');
  if (listing.status !== 'draft') return ok({ redirect: `/marked/listing/${input.listingId}` });

  const siteUrl = ctx.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  const stripe = createStripe(input.stripeSecretKey);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'nok', unit_amount: LISTING_FEE_NOK * 100,
        product_data: { name: `Annonsegebyr: ${listing.title}` },
      },
      quantity: 1,
    }],
    success_url: `${siteUrl}/marked/listing/${input.listingId}?published=1`,
    cancel_url: `${siteUrl}/marked/listing/${input.listingId}`,
    customer_email: ctx.user.email ?? undefined,
    client_reference_id: ctx.user.id,
    metadata: { type: 'listing_fee', listing_id: input.listingId, user_id: ctx.user.id, seller_id: ctx.user.id },
    locale: 'nb',
  });

  if (!session.url) return fail('server_error', 'Checkout URL missing');
  return ok({ redirect: session.url });
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
    await syncHero(ctx.supabase, input.listingId);
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
  await syncHero(ctx.supabase, input.listingId);
  return ok(undefined as void);
}

const MAX_PHOTOS = 6;

export async function uploadListingPhotos(
  ctx: ServiceContext,
  input: { listingId: string; files: File[] },
): Promise<ServiceResult<{ redirect: string }>> {
  if (input.files.length === 0) return ok({ redirect: `/marked/listing/${input.listingId}` });

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

  await syncHero(ctx.supabase, input.listingId);
  return ok({ redirect: `/marked/listing/${input.listingId}` });
}
