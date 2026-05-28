import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createStripe } from '../stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

const PROMOTION_DAYS = 7;

const TIER_PRICE: Record<string, number> = {
  boost: 49,
  highlight: 99,
};

const TIER_LABEL: Record<string, string> = {
  boost: 'Boost',
  highlight: 'Fremhevet',
};

const TIER_DAILY_BUDGET: Record<string, number> = {
  boost: 50,
  highlight: 150,
};

export async function promoteListing(
  ctx: ServiceContext,
  input: { listingId: string; tier: string },
): Promise<ServiceResult<{ redirect: string }>> {
  const tier = input.tier;
  if (!TIER_PRICE[tier]) return fail('bad_input', 'Ugyldig promoteringstier');

  const { data: listing } = await ctx.supabase
    .from('listings')
    .select('id, seller_id, title, status, promoted_until')
    .eq('id', input.listingId)
    .maybeSingle();

  if (!listing || listing.seller_id !== ctx.user.id) return fail('not_found', 'Annonse ikke funnet');
  if (listing.status !== 'active') return fail('bad_input', 'Kun aktive annonser kan promoteres');

  if (listing.promoted_until && new Date(listing.promoted_until) > new Date()) {
    return fail('conflict', 'Annonsen er allerede promotert');
  }

  const price = TIER_PRICE[tier];
  const siteUrl = ctx.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'nok',
        unit_amount: price * 100,
        product_data: { name: `${TIER_LABEL[tier]}: ${listing.title}` },
      },
      quantity: 1,
    }],
    success_url: `${siteUrl}/market/listing/${input.listingId}?promoted=1`,
    cancel_url: `${siteUrl}/market/listing/${input.listingId}`,
    customer_email: ctx.user.email ?? undefined,
    client_reference_id: ctx.user.id,
    metadata: {
      type: 'listing_promotion',
      listing_id: input.listingId,
      seller_id: ctx.user.id,
      tier,
    },
    locale: 'nb',
  });

  if (!session.url) return fail('server_error', 'Checkout URL missing');

  await ctx.admin.from('listing_promotions').insert({
    listing_id: input.listingId,
    seller_id: ctx.user.id,
    tier,
    ends_at: new Date(Date.now() + PROMOTION_DAYS * 86400_000).toISOString(),
    price_nok: price,
    stripe_session_id: session.id,
    status: 'pending',
    daily_budget: TIER_DAILY_BUDGET[tier],
  });

  return ok({ redirect: session.url });
}

/** Dev/admin convenience: activate a promotion without going through
 *  Stripe Checkout. Used by the "Simuler" buttons on the listing detail
 *  page (localhost) and by admins for manual gifting. */
export async function simulatePromotion(
  ctx: ServiceContext,
  input: { listingId: string; tier: string; requestHost?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  const tier = input.tier;
  if (!TIER_PRICE[tier]) return fail('bad_input', 'Ugyldig promoteringstier');

  const { data: profile } = await ctx.admin
    .from('profiles').select('role').eq('id', ctx.user.id).maybeSingle();
  const isStaff = profile?.role === 'admin' || profile?.role === 'moderator';
  // Real request host (not the PUBLIC_SITE_URL env, which usually points
  // at the prod host even during local dev).
  const host = input.requestHost ?? '';
  const isLocal = host === 'localhost' || host.startsWith('localhost:')
    || host === '127.0.0.1' || host.startsWith('127.0.0.1:')
    || host.startsWith('192.168.');
  if (!isLocal && !isStaff) return fail('forbidden', 'Kun staff kan simulere uten betaling');

  const { data: listing } = await ctx.admin
    .from('listings')
    .select('id, seller_id, title, status, promoted_until')
    .eq('id', input.listingId)
    .maybeSingle();
  if (!listing) return fail('not_found', 'Annonse ikke funnet');
  if (listing.status !== 'active') return fail('bad_input', 'Kun aktive annonser kan promoteres');
  if (listing.promoted_until && new Date(listing.promoted_until) > new Date()) {
    return fail('conflict', 'Annonsen er allerede promotert');
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + PROMOTION_DAYS * 86400_000);

  await ctx.admin.from('listing_promotions').insert({
    listing_id: input.listingId,
    seller_id: listing.seller_id,
    tier,
    starts_at: now.toISOString(),
    ends_at: endsAt.toISOString(),
    price_nok: TIER_PRICE[tier],
    stripe_session_id: `dev-sim-${Date.now()}`,
    status: 'active',
    daily_budget: TIER_DAILY_BUDGET[tier],
    daily_window_start: now.toISOString(),
  });

  await ctx.admin.from('listings').update({
    promoted_until: endsAt.toISOString(),
    promotion_tier: tier,
    promoted_at: now.toISOString(),
  }).eq('id', input.listingId);

  return ok({ redirect: `/market/listing/${input.listingId}?promoted=1` });
}

export async function getActivePromotion(
  supabase: SupabaseClient,
  listingId: string,
): Promise<{ tier: string; ends_at: string } | null> {
  const { data } = await supabase
    .from('listing_promotions')
    .select('tier, ends_at')
    .eq('listing_id', listingId)
    .eq('status', 'active')
    .order('ends_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export type PromotionAudience = {
  top_categories: Array<{ category: string; count: number }>;
  top_sizes: Array<{ size_label: string; count: number }>;
  viewer_count: number;
};

export async function getPromotionStats(
  ctx: ServiceContext,
  input: { listingId: string },
): Promise<ServiceResult<{
  organic: { impressions: number; clicks: number };
  promoted: { impressions: number; clicks: number };
  totalDays: number;
  audience: PromotionAudience;
}>> {
  const { data: listing } = await ctx.supabase
    .from('listings')
    .select('id, seller_id')
    .eq('id', input.listingId)
    .maybeSingle();

  if (!listing || listing.seller_id !== ctx.user.id) return fail('not_found', 'Ikke funnet');

  const [{ count: organicImpressions }, { count: organicClicks }, { count: promoImpressions }, { count: promoClicks }, { data: promotions }] = await Promise.all([
    ctx.admin.from('listing_impressions').select('id', { count: 'exact', head: true }).eq('listing_id', input.listingId).eq('promoted', false),
    ctx.admin.from('listing_impressions').select('id', { count: 'exact', head: true }).eq('listing_id', input.listingId).eq('promoted', false).eq('clicked', true),
    ctx.admin.from('listing_impressions').select('id', { count: 'exact', head: true }).eq('listing_id', input.listingId).eq('promoted', true),
    ctx.admin.from('listing_impressions').select('id', { count: 'exact', head: true }).eq('listing_id', input.listingId).eq('promoted', true).eq('clicked', true),
    ctx.admin.from('listing_promotions').select('starts_at, ends_at').eq('listing_id', input.listingId).eq('status', 'active'),
  ]);

  const totalDays = (promotions ?? []).reduce((sum, p) => {
    const start = new Date(p.starts_at).getTime();
    const end = Math.min(new Date(p.ends_at).getTime(), Date.now());
    return sum + Math.max(0, Math.ceil((end - start) / 86400_000));
  }, 0);

  const { data: audienceRaw } = await ctx.admin
    .rpc('promotion_audience_breakdown', { p_listing_id: input.listingId });
  const audience: PromotionAudience = (audienceRaw as PromotionAudience | null)
    ?? { top_categories: [], top_sizes: [], viewer_count: 0 };

  return ok({
    organic: { impressions: organicImpressions ?? 0, clicks: organicClicks ?? 0 },
    promoted: { impressions: promoImpressions ?? 0, clicks: promoClicks ?? 0 },
    totalDays,
    audience,
  });
}
