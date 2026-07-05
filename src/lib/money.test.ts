import { describe, it, expect } from 'vitest';
import { MoneyBreakdown, MoneyInvariantError, krToOre, legacyListingFeeNokFromTotalOre } from './money';
import { tbFeeForPrice } from './shipping';
import { commissionFeeNok } from './commission-pricing';

// The money authority is the safety net for every payment calculation. These
// tests exhaustively sweep prices/shipping across rounding boundaries and
// assert the invariants hold, and that the class REFUSES to construct a broken
// breakdown.

// Prices spanning the TB-fee tiers (≤200 / ≤500 / >500) and commission edges.
const PRICES = [0, 1, 9, 99, 100, 149, 199, 200, 201, 349, 499, 500, 501, 999, 1000, 4999, 5000];
const SHIPPING = [0, 9, 29, 69, 140];

function assertInvariants(b: MoneyBreakdown) {
  // integer øre, non-negative
  for (const v of [b.buyerChargeOre, b.sellerCreditOre, b.platformFeeOre, b.itemOre, b.shippingOre]) {
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
  }
  // conservation
  expect(b.sellerCreditOre + b.platformFeeOre).toBe(b.buyerChargeOre);
  // itemised parts reconcile
  expect(b.itemOre + b.shippingOre + b.platformFeeOre).toBe(b.buyerChargeOre);
  // fee is a sane share
  expect(b.platformFeeOre).toBeLessThanOrEqual(b.buyerChargeOre);
  expect(b.applicationFeeOre).toBe(b.platformFeeOre);
}

describe('MoneyBreakdown.listingPurchase', () => {
  for (const priceNok of PRICES) {
    for (const shippingNok of SHIPPING) {
      it(`conserves at price ${priceNok} + shipping ${shippingNok}`, () => {
        const b = MoneyBreakdown.listingPurchase({ priceNok, shippingNok });
        assertInvariants(b);
        // The platform fee is exactly the TB fee; the seller gets item + shipping.
        expect(b.platformFeeOre).toBe(krToOre(tbFeeForPrice(priceNok)));
        expect(b.sellerCreditOre).toBe(krToOre(priceNok) + krToOre(shippingNok));
        expect(b.buyerChargeOre).toBe(krToOre(priceNok) + krToOre(shippingNok) + krToOre(tbFeeForPrice(priceNok)));
      });
    }
  }
});

describe('MoneyBreakdown.commissionPayment', () => {
  for (const priceNok of PRICES) {
    it(`conserves at price ${priceNok}`, () => {
      const b = MoneyBreakdown.commissionPayment({ priceNok });
      assertInvariants(b);
      expect(b.shippingOre).toBe(0);
      // Knitter keeps 100%; buyer pays the fee on top.
      expect(b.sellerCreditOre).toBe(krToOre(priceNok));
      expect(b.platformFeeOre).toBe(krToOre(commissionFeeNok(priceNok)));
      expect(b.buyerChargeOre).toBe(krToOre(priceNok) + krToOre(commissionFeeNok(priceNok)));
    });
  }
});

describe('line items', () => {
  it('lists item + shipping + fee, omitting zero parts', () => {
    const b = MoneyBreakdown.listingPurchase({ priceNok: 349, shippingNok: 29 });
    const li = b.lineItems({ item: 'Genser', shipping: 'Frakt', fee: 'Trygg betaling' });
    expect(li).toEqual([
      { name: 'Genser', amountOre: 34900 },
      { name: 'Frakt', amountOre: 2900 },
      { name: 'Trygg betaling', amountOre: krToOre(tbFeeForPrice(349)) },
    ]);
    // Sum of line items == buyer charge (no money invented in the display).
    expect(li.reduce((s, x) => s + x.amountOre, 0)).toBe(b.buyerChargeOre);
  });

  it('omits shipping when free', () => {
    const b = MoneyBreakdown.listingPurchase({ priceNok: 100, shippingNok: 0 });
    const names = b.lineItems({ item: 'X', fee: 'Fee' }).map((x) => x.name);
    expect(names).not.toContain('Frakt');
  });

  it('defaults the shipping label to "Frakt" when none is given', () => {
    const b = MoneyBreakdown.listingPurchase({ priceNok: 100, shippingNok: 29 });
    const li = b.lineItems({ item: 'X', fee: 'Fee' }); // no shipping label
    expect(li.find((x) => x.amountOre === 2900)?.name).toBe('Frakt');
  });
});

describe('the class refuses to construct a broken breakdown', () => {
  // A fully valid baseline; each rejection case violates exactly ONE invariant.
  const valid = { itemOre: 100, shippingOre: 0, platformFeeOre: 8, sellerCreditOre: 100, buyerChargeOre: 108 };

  it('accepts a valid part set and exposes it', () => {
    const b = MoneyBreakdown.build('commission_payment', valid);
    expect(b.buyerChargeOre).toBe(108);
    expect(b.sellerCreditOre).toBe(100);
    expect(b.platformFeeOre).toBe(8);
    expect(b.applicationFeeOre).toBe(8); // alias
    expect(b.itemOre).toBe(100);
    expect(b.shippingOre).toBe(0);
  });

  it('rejects a non-integer øre', () => {
    expect(() => MoneyBreakdown.build('commission_payment', { ...valid, itemOre: 100.5, sellerCreditOre: 100.5, buyerChargeOre: 108.5 }))
      .toThrow(/not an integer/);
  });

  it('rejects a negative amount', () => {
    expect(() => MoneyBreakdown.build('commission_payment', { itemOre: -1, shippingOre: 0, platformFeeOre: 0, sellerCreditOre: -1, buyerChargeOre: -1 }))
      .toThrow(/negative/);
  });

  it('rejects a conservation break (seller + fee ≠ buyer charge)', () => {
    // itemised still reconciles; only conservation fails.
    expect(() => MoneyBreakdown.build('commission_payment', { itemOre: 100, shippingOre: 0, platformFeeOre: 8, sellerCreditOre: 90, buyerChargeOre: 108 }))
      .toThrow(/conservation/);
  });

  it('rejects itemised parts that do not reconcile to the buyer charge', () => {
    // conservation holds (seller 100 + fee 8 = 108) but item+ship+fee ≠ 108.
    expect(() => MoneyBreakdown.build('commission_payment', { itemOre: 90, shippingOre: 0, platformFeeOre: 8, sellerCreditOre: 100, buyerChargeOre: 108 }))
      .toThrow(/line items/);
  });

  it('krToOre rounds to integer øre and rejects non-finite', () => {
    expect(krToOre(1)).toBe(100);
    expect(krToOre(0)).toBe(0);
    expect(krToOre(29)).toBe(2900);
    expect(krToOre(15.925)).toBe(1593); // rounds
    expect(() => krToOre(Infinity)).toThrow(MoneyInvariantError);
    expect(() => MoneyBreakdown.commissionPayment({ priceNok: 100.5 })).not.toThrow(); // rounds cleanly
  });

  it('legacyListingFeeNokFromTotalOre: 13% of the gross in whole kr, 0 for empty', () => {
    expect(legacyListingFeeNokFromTotalOre(0)).toBe(0);
    expect(legacyListingFeeNokFromTotalOre(null)).toBe(0);
    expect(legacyListingFeeNokFromTotalOre(undefined)).toBe(0);
    expect(legacyListingFeeNokFromTotalOre(10000)).toBe(13);   // 100 kr → 13 kr
    expect(legacyListingFeeNokFromTotalOre(29900)).toBe(39);   // 299 kr → 38.87 → 39 kr
    expect(legacyListingFeeNokFromTotalOre(100000)).toBe(130); // 1000 kr → 130 kr
  });
});
