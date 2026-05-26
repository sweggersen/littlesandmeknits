import { describe, it, expect } from 'vitest';
import { scorePromoted, rankPromoted, type UserPreferences, type RankableListing } from './promotion-ranker';

function listing(overrides: Partial<RankableListing> = {}): RankableListing {
  return {
    id: overrides.id ?? 'l1',
    category: 'cardigan',
    size_label: '92',
    price_nok: 350,
    seller_id: 's1',
    promotion_tier: 'boost',
    promoted_at: new Date(Date.now() - 3 * 86400_000).toISOString(), // 3 days in
    daily_impressions_served: 0,
    daily_budget: 50,
    ...overrides,
  };
}

function prefs(overrides: Partial<NonNullable<UserPreferences>> = {}): UserPreferences {
  return {
    favorited_categories: [],
    clicked_categories: [],
    clicked_sizes: [],
    followed_sellers: [],
    price_band: null,
    age_band: null,
    ...overrides,
  };
}

describe('scorePromoted', () => {
  it('cold-start (no prefs) returns a positive but small score driven by tier × baseline', () => {
    const score = scorePromoted(listing(), null);
    // relevance = 0.1 baseline, bid = 0.5 (boost), freshness = 1.0, pacing = 1.0
    // → 0.1 × 0.5 × 1.0 × 1.0 = 0.05
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.1);
  });

  it('highlight outranks boost when other factors equal', () => {
    const boost = scorePromoted(listing({ promotion_tier: 'boost' }), null);
    const highlight = scorePromoted(listing({ promotion_tier: 'highlight' }), null);
    expect(highlight).toBeGreaterThan(boost);
  });

  it('favorited category lifts relevance to ceiling', () => {
    const p = prefs({ favorited_categories: [{ category: 'cardigan', count: 3 }] });
    const score = scorePromoted(listing({ category: 'cardigan' }), p);
    const miss = scorePromoted(listing({ category: 'genser' }), p);
    expect(score).toBeGreaterThan(miss);
  });

  it('followed seller adds the 0.20 weight', () => {
    const followed = prefs({ followed_sellers: ['s1'] });
    const notFollowed = prefs();
    const a = scorePromoted(listing({ seller_id: 's1' }), followed);
    const b = scorePromoted(listing({ seller_id: 's1' }), notFollowed);
    expect(a).toBeGreaterThan(b);
  });

  it('price inside the band scores higher than far outside', () => {
    const p = prefs({ price_band: { p25: 300, p50: 400, p75: 500, n: 10 } });
    const inBand = scorePromoted(listing({ price_nok: 400 }), p);
    const farOut = scorePromoted(listing({ price_nok: 5000 }), p);
    expect(inBand).toBeGreaterThan(farOut);
  });

  it('freshness bump applies within first 24h after promoted_at', () => {
    const fresh = scorePromoted(listing({ promoted_at: new Date().toISOString() }), null);
    const stale = scorePromoted(listing({ promoted_at: new Date(Date.now() - 7 * 86400_000).toISOString() }), null);
    expect(fresh).toBeGreaterThan(stale);
  });

  it('exhausted daily budget multiplies by 0.3 (does not silence)', () => {
    const paced = scorePromoted(listing({ daily_impressions_served: 100, daily_budget: 50 }), null);
    const unpaced = scorePromoted(listing(), null);
    expect(paced).toBeLessThan(unpaced);
    expect(paced).toBeGreaterThan(0);
    // 0.3x ratio (modulo freshness math; not exact equality)
    expect(paced / unpaced).toBeCloseTo(0.3, 1);
  });
});

describe('rankPromoted', () => {
  it('sorts by descending score', () => {
    const a = listing({ id: 'a', promotion_tier: 'boost' });
    const b = listing({ id: 'b', promotion_tier: 'highlight' });
    const c = listing({ id: 'c', promotion_tier: 'boost' });
    const ranked = rankPromoted([a, b, c], null);
    expect(ranked[0].id).toBe('b'); // highlight wins ties
  });

  it('does not mutate input', () => {
    const input = [listing({ id: 'a' }), listing({ id: 'b', promotion_tier: 'highlight' })];
    const snapshot = input.map((l) => l.id);
    rankPromoted(input, null);
    expect(input.map((l) => l.id)).toEqual(snapshot);
  });
});
