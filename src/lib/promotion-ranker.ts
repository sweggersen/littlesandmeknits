// Promoted-pool ranker. Pure, no I/O. Given a viewer's aggregated
// preferences (from the user_preferences matview) and a listing, produce
// a score. Higher score = surface first within the promoted pool.
//
// score = relevance(c,u) × bid_weight(c) × freshness(c) × pacing(c)
// See docs/RANKING.md for the weight rationale.

export type UserPreferences = {
  favorited_categories: Array<{ category: string; count: number }>;
  clicked_categories: Array<{ category: string; weight: number; count: number }>;
  clicked_sizes: Array<{ size_label: string; weight: number; count: number }>;
  followed_sellers: string[];
  price_band: { p25: number; p50: number; p75: number; n: number } | null;
  age_band: { min: number | null; max: number | null; n: number } | null;
} | null;

export type RankableListing = {
  id: string;
  category?: string | null;
  size_label?: string | null;
  size_age_months_min?: number | null;
  size_age_months_max?: number | null;
  price_nok?: number | null;
  seller_id?: string | null;
  promotion_tier?: 'boost' | 'highlight' | null;
  promoted_until?: string | null;
  promoted_at?: string | null; // set by promotion start; fall back to promoted_until - 7d
  daily_impressions_served?: number | null;
  daily_budget?: number | null;
};

const WEIGHTS = {
  category: 0.30,
  size: 0.25,
  followedSeller: 0.20, // not yet wired
  priceBand: 0.15,
  conditionBaseline: 0.10,
};

const TIER_WEIGHT: Record<string, number> = {
  boost: 0.5,
  highlight: 1.0,
};

function categoryAffinity(category: string | null | undefined, prefs: NonNullable<UserPreferences>): number {
  if (!category) return 0;
  // Favorites are strong intent; clicked categories are weaker but more
  // recent. A category that appears in either gets credit.
  const fav = prefs.favorited_categories.find((c) => c.category === category);
  if (fav) return 1.0;
  const clicked = prefs.clicked_categories.find((c) => c.category === category);
  if (clicked) {
    // Normalise against the top-clicked category's weight.
    const top = prefs.clicked_categories[0]?.weight ?? clicked.weight;
    return top > 0 ? Math.min(1, clicked.weight / top) : 0;
  }
  return 0;
}

function sizeAffinity(sizeLabel: string | null | undefined, prefs: NonNullable<UserPreferences>): number {
  if (!sizeLabel || prefs.clicked_sizes.length === 0) return 0;
  const hit = prefs.clicked_sizes.find((s) => s.size_label === sizeLabel);
  if (!hit) return 0;
  const top = prefs.clicked_sizes[0]?.weight ?? hit.weight;
  return top > 0 ? Math.min(1, hit.weight / top) : 0;
}

function priceBandAffinity(price: number | null | undefined, prefs: NonNullable<UserPreferences>): number {
  if (!price || !prefs.price_band) return 0;
  const { p25, p75 } = prefs.price_band;
  if (price >= p25 && price <= p75) return 1.0;
  // Soft falloff outside the IQR.
  const width = Math.max(1, p75 - p25);
  const dist = price < p25 ? p25 - price : price - p75;
  return Math.max(0, 1 - dist / (2 * width));
}

export function scorePromoted(listing: RankableListing, prefs: UserPreferences): number {
  let relevance = WEIGHTS.conditionBaseline; // baseline so cold-start isn't 0
  if (prefs) {
    relevance += WEIGHTS.category * categoryAffinity(listing.category, prefs);
    relevance += WEIGHTS.size * sizeAffinity(listing.size_label, prefs);
    relevance += WEIGHTS.priceBand * priceBandAffinity(listing.price_nok, prefs);
    if (listing.seller_id && prefs.followed_sellers?.includes(listing.seller_id)) {
      relevance += WEIGHTS.followedSeller;
    }
  }
  relevance = Math.max(0.1, Math.min(1.0, relevance));

  const bid = TIER_WEIGHT[listing.promotion_tier ?? ''] ?? 0.5;

  // Freshness: new promotions get up to 1.5x for the first 24h.
  let freshness = 1.0;
  const startIso = listing.promoted_at
    ?? (listing.promoted_until
      ? new Date(new Date(listing.promoted_until).getTime() - 7 * 86400_000).toISOString()
      : null);
  if (startIso) {
    const hours = (Date.now() - new Date(startIso).getTime()) / 3.6e6;
    if (hours >= 0 && hours < 24) freshness = 1.5 - hours / 48; // 1.5 → 1.0 over 24h
  }

  // Pacing: de-prioritise (but don't silence) once a listing exhausts its
  // daily impression budget.
  const served = listing.daily_impressions_served ?? 0;
  const budget = listing.daily_budget ?? 0;
  const pacing = budget > 0 && served >= budget ? 0.3 : 1.0;

  return relevance * bid * freshness * pacing;
}

export function rankPromoted<T extends RankableListing>(listings: T[], prefs: UserPreferences): T[] {
  return [...listings]
    .map((l) => ({ l, s: scorePromoted(l, prefs) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.l);
}
