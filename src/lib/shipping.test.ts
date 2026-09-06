import { describe, it, expect } from 'vitest';
import {
  SHIPPING_TIERS, SHIPPING_RATES_VERIFIED_ON,
  shippingTier, isTrackedTier, tbFeeForPrice, purchaseBreakdown,
} from './shipping';

describe('shipping rate freshness (drift guard)', () => {
  it('the rates were verified within the last 18 months', () => {
    const verified = new Date(SHIPPING_RATES_VERIFIED_ON);
    expect(Number.isNaN(verified.getTime()), `SHIPPING_RATES_VERIFIED_ON="${SHIPPING_RATES_VERIFIED_ON}" is not a valid date`).toBe(false);
    const monthsOld = (Date.now() - verified.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    // When this fails: open posten.no/priser, confirm/adjust SHIPPING_TIERS
    // prices, then bump SHIPPING_RATES_VERIFIED_ON to today.
    expect(
      monthsOld,
      `Shipping rates last verified ${SHIPPING_RATES_VERIFIED_ON} (${monthsOld.toFixed(1)} months ago). Re-check posten.no/priser and bump SHIPPING_RATES_VERIFIED_ON.`,
    ).toBeLessThan(18);
  });
});

describe('shippingTier / isTrackedTier', () => {
  it('resolves a known tier and returns null for unknown/null', () => {
    expect(shippingTier('small_parcel')?.priceNok).toBe(76);
    expect(shippingTier(null)).toBeNull();
    expect(shippingTier('nope' as never)).toBeNull();
  });

  it('parcels are tracked; free + brev are not', () => {
    expect(isTrackedTier('small_parcel')).toBe(true);
    expect(isTrackedTier('parcel')).toBe(true);
    expect(isTrackedTier('small_letter')).toBe(false);
    expect(isTrackedTier('free')).toBe(false);
    expect(isTrackedTier(null)).toBe(false);
  });

  it('every tier has a non-negative integer price and the free tier is 0', () => {
    for (const t of SHIPPING_TIERS) {
      expect(Number.isInteger(t.priceNok), `${t.id} price must be an integer`).toBe(true);
      expect(t.priceNok, `${t.id} price must be >= 0`).toBeGreaterThanOrEqual(0);
    }
    expect(shippingTier('free')?.priceNok).toBe(0);
  });
});

describe('tbFeeForPrice — Trygg betaling tiers', () => {
  it('is 0 for non-positive prices', () => {
    expect(tbFeeForPrice(0)).toBe(0);
    expect(tbFeeForPrice(-5)).toBe(0);
  });

  it('steps at the 200 and 500 boundaries', () => {
    expect(tbFeeForPrice(1)).toBe(9);
    expect(tbFeeForPrice(200)).toBe(9);
    expect(tbFeeForPrice(201)).toBe(19);
    expect(tbFeeForPrice(500)).toBe(19);
    expect(tbFeeForPrice(501)).toBe(29);
    expect(tbFeeForPrice(99999)).toBe(29);
  });
});

describe('purchaseBreakdown', () => {
  it('conserves total = item + shipping + tb', () => {
    const b = purchaseBreakdown(300, 'small_parcel', true);
    expect(b.itemNok).toBe(300);
    expect(b.shippingNok).toBe(76);
    expect(b.tbFeeNok).toBe(19);
    expect(b.totalNok).toBe(300 + 76 + 19);
    expect(b.totalNok).toBe(b.itemNok + b.shippingNok + b.tbFeeNok);
  });

  it('omits the tb fee when escrow is disabled', () => {
    const b = purchaseBreakdown(300, 'small_parcel', false);
    expect(b.tbFeeNok).toBe(0);
    expect(b.totalNok).toBe(376);
  });

  it('falls back to the free tier for a null/unknown shipping option', () => {
    const b = purchaseBreakdown(300, null, true);
    expect(b.shippingNok).toBe(0);
    expect(b.shippingLabel).toBe('Gratis frakt');
    expect(b.totalNok).toBe(300 + 0 + 19);
  });

  it('conserves across a price sweep for every tier', () => {
    for (const tier of SHIPPING_TIERS) {
      for (const price of [1, 200, 201, 500, 501, 1499]) {
        const b = purchaseBreakdown(price, tier.id, true);
        expect(b.totalNok, `${tier.id} @ ${price}`).toBe(b.itemNok + b.shippingNok + b.tbFeeNok);
      }
    }
  });
});
