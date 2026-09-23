import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createStripe } from '../stripe';
import { killGuard } from '../flags';
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
  const blocked = await killGuard(['purchases'], ctx.env);
  if (blocked) return blocked;

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

  // Double-charge guard: mode:'payment' auto-captures, so a double-click that
  // mints two sessions would take the seller's money twice (the promoted_until
  // check above only trips AFTER the webhook activates the first one). Reuse the
  // most recent still-pending promotion's checkout session instead of minting a
  // second capturable one. If it's already paid, don't create another — the
  // webhook will activate it shortly.
  const { data: pending } = await ctx.admin
    .from('listing_promotions')
    .select('id, stripe_session_id')
    .eq('listing_id', input.listingId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pending?.stripe_session_id) {
    const existing = await stripe.checkout.sessions
      .retrieve(pending.stripe_session_id)
      .catch(() => null);
    if (existing) {
      if (existing.payment_status === 'paid' || existing.status === 'complete') {
        return ok({ redirect: `${siteUrl}/market/listing/${input.listingId}?promoted=1` });
      }
      if (existing.status === 'open' && existing.url) {
        return ok({ redirect: existing.url });
      }
      // expired / canceled → fall through and mint a fresh session
    }
  }

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
    // Bound the session so an abandoned checkout can't be paid days later and
    // become a duplicate charge (matches payCommission). 2h suits a real buyer.
    expires_at: Math.floor(Date.now() / 1000) + 2 * 60 * 60,
    metadata: {
      type: 'listing_promotion',
      listing_id: input.listingId,
      seller_id: ctx.user.id,
      tier,
    },
    locale: 'nb',
  });

  if (!session.url) return fail('server_error', 'Checkout URL missing');

  // The webhook activates the promotion by matching this row on stripe_session_id.
  // If the insert fails we must NOT send the seller to checkout — they'd be
  // charged with no row for the webhook to flip to 'active' (seller charged, no
  // promotion). Surface the failure instead.
  const { error: promoErr } = await ctx.admin.from('listing_promotions').insert({
    listing_id: input.listingId,
    seller_id: ctx.user.id,
    tier,
    ends_at: new Date(Date.now() + PROMOTION_DAYS * 86400_000).toISOString(),
    price_nok: price,
    stripe_session_id: session.id,
    status: 'pending',
    daily_budget: TIER_DAILY_BUDGET[tier],
  });
  if (promoErr) {
    return fail('server_error', 'Kunne ikke starte promotering. Prøv igjen.');
  }

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
