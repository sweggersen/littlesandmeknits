import { describe, it, expect } from 'vitest';
import {
  computePersonalStoreScore,
  recommendationForPersonalStore,
  recommendationForStoreScore,
} from './moderation';

const base = {
  activeListings: 0,
  completedTransactions: 0,
  reviewAvg: 0,
  reviewCount: 0,
  accountAgeDays: 0,
  totalRejections: 0,
};

describe('computePersonalStoreScore', () => {
  it('a brand-new seller scores low but never negative', () => {
    const { total, breakdown } = computePersonalStoreScore(base);
    expect(total).toBe(0);
    expect(total).toBeGreaterThanOrEqual(0);
    // The breakdown surfaces the activity signals to the moderator.
    expect(breakdown.map((b) => b.label)).toEqual([
      'Aktive annonser', 'Fullførte salg', 'Vurderinger', 'Kontoalder', 'Tidligere avvisninger',
    ]);
  });

  it('favours active listings, sales and activity', () => {
    const active = computePersonalStoreScore({ ...base, activeListings: 5 }).total;
    const sales = computePersonalStoreScore({ ...base, completedTransactions: 5 }).total;
    expect(active).toBeGreaterThan(0);
    expect(sales).toBeGreaterThan(active); // sales weigh more than listings
    // A clearly active seller lands high.
    const strong = computePersonalStoreScore({
      activeListings: 10, completedTransactions: 10,
      reviewAvg: 4.8, reviewCount: 5, accountAgeDays: 400, totalRejections: 0,
    }).total;
    expect(strong).toBeGreaterThanOrEqual(75);
  });

  it('penalises past rejections but stays >= 0', () => {
    const clean = computePersonalStoreScore({ ...base, activeListings: 3 }).total;
    const flagged = computePersonalStoreScore({ ...base, activeListings: 3, totalRejections: 10 }).total;
    expect(flagged).toBeLessThan(clean);
    expect(flagged).toBeGreaterThanOrEqual(0);
  });
});

describe('recommendationForPersonalStore', () => {
  it('never recommends rejection just for lacking an org number', () => {
    // Even a zero-activity personal store is at worst "check content", not red.
    for (const score of [0, 10, 24, 25, 49, 50, 100]) {
      const rec = recommendationForPersonalStore(score);
      expect(rec.tone).not.toBe('red');
      expect(rec.label).not.toMatch(/avvisning/i);
    }
  });

  it('business (org) stores still get the strict rejection path at 0', () => {
    // Sanity: the org path is unchanged and still can go red.
    expect(recommendationForStoreScore(0).tone).toBe('red');
  });
});
