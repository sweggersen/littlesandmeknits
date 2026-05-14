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
    success_url: `${siteUrl}/marked/listing/${input.listingId}?promoted=1`,
    cancel_url: `${siteUrl}/marked/listing/${input.listingId}`,
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
  });

  return ok({ redirect: session.url });
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

export async function getPromotionStats(
  ctx: ServiceContext,
  input: { listingId: string },
): Promise<ServiceResult<{
  organic: { impressions: number; clicks: number };
  promoted: { impressions: number; clicks: number };
  totalDays: number;
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

  return ok({
    organic: { impressions: organicImpressions ?? 0, clicks: organicClicks ?? 0 },
    promoted: { impressions: promoImpressions ?? 0, clicks: promoClicks ?? 0 },
    totalDays,
  });
}
