// ─────────────────────────────────────────────────────────────────────────
// Money authority. EVERY payment/fee calculation on the platform must go
// through MoneyBreakdown. It is the single place fee formulas are assembled,
// and it VALIDATES the money invariants on construction — so a wrong number
// can't reach Stripe or the ledger silently; it throws.
//
// Rules enforced by construction (see validate()):
//   1. Every amount is a non-negative INTEGER of øre (no fractional currency,
//      no negatives).
//   2. CONSERVATION: what the buyer is charged is split EXACTLY between the
//      seller credit and the platform fee — nothing created or destroyed.
//      buyerChargeOre === sellerCreditOre + platformFeeOre
//   3. The platform fee is a sane share: 0 ≤ platformFeeOre ≤ buyerChargeOre.
//   4. The itemised parts (item + shipping + fee) sum to the buyer charge.
//
// Structural guard: money-boundary.test.ts fails CI if a service computes fees
// with raw arithmetic or calls a fee formula directly instead of via this file.
// ─────────────────────────────────────────────────────────────────────────

import { tbFeeForPrice } from './shipping';
import { commissionFeeNok } from './commission-pricing';

export class MoneyInvariantError extends Error {
  constructor(message: string) {
    super(`MoneyInvariant: ${message}`);
    this.name = 'MoneyInvariantError';
  }
}

/** NOK → øre. Guards against a fractional-kroner input sneaking in. */
export function krToOre(nok: number): number {
  if (!Number.isFinite(nok)) throw new MoneyInvariantError(`kr ${nok} is not finite`);
  const ore = Math.round(nok * 100);
  return ore;
}

export interface MoneyParts {
  /** Total the buyer is charged. */
  buyerChargeOre: number;
  /** What the seller / knitter (or their store) receives. */
  sellerCreditOre: number;
  /** The platform's retained cut (Stripe application fee for destination charges). */
  platformFeeOre: number;
  /** The item / knit price component. */
  itemOre: number;
  /** Shipping component (passes through to the seller). 0 for commissions. */
  shippingOre: number;
}

export type MoneyKind = 'listing_purchase' | 'commission_payment';

export class MoneyBreakdown {
  private constructor(
    readonly kind: MoneyKind,
    private readonly p: MoneyParts,
  ) {
    this.validate();
  }

  /** General validated constructor. Domain factories delegate here; also the
   *  seam tests use to prove the invariants REJECT malformed parts. */
  static build(kind: MoneyKind, parts: MoneyParts): MoneyBreakdown {
    return new MoneyBreakdown(kind, parts);
  }

  private validate(): void {
    const entries = Object.entries(this.p) as [string, number][];
    for (const [k, v] of entries) {
      if (!Number.isInteger(v)) throw new MoneyInvariantError(`${this.kind}.${k}=${v} is not an integer øre`);
      if (v < 0) throw new MoneyInvariantError(`${this.kind}.${k}=${v} is negative`);
    }
    const { buyerChargeOre, sellerCreditOre, platformFeeOre, itemOre, shippingOre } = this.p;
    // (2) conservation: buyer pays exactly seller credit + platform fee. (This
    // plus non-negativity also guarantees 0 ≤ fee ≤ buyer charge.)
    if (sellerCreditOre + platformFeeOre !== buyerChargeOre) {
      throw new MoneyInvariantError(
        `${this.kind}: conservation broken — buyer ${buyerChargeOre} ≠ seller ${sellerCreditOre} + fee ${platformFeeOre}`,
      );
    }
    // (3) itemised parts reconcile to the buyer charge.
    if (itemOre + shippingOre + platformFeeOre !== buyerChargeOre) {
      throw new MoneyInvariantError(
        `${this.kind}: line items ${itemOre}+${shippingOre}+${platformFeeOre} ≠ buyer charge ${buyerChargeOre}`,
      );
    }
  }

  get buyerChargeOre(): number { return this.p.buyerChargeOre; }
  get sellerCreditOre(): number { return this.p.sellerCreditOre; }
  get platformFeeOre(): number { return this.p.platformFeeOre; }
  /** Alias — for a destination charge the platform fee IS the Stripe application fee. */
  get applicationFeeOre(): number { return this.p.platformFeeOre; }
  get itemOre(): number { return this.p.itemOre; }
  get shippingOre(): number { return this.p.shippingOre; }

  /** Checkout line items (name + unit_amount in øre) — item, shipping, fee.
   *  Zero-amount parts are omitted. */
  lineItems(labels: { item: string; shipping?: string; fee: string }): { name: string; amountOre: number }[] {
    const out: { name: string; amountOre: number }[] = [{ name: labels.item, amountOre: this.p.itemOre }];
    if (this.p.shippingOre > 0) out.push({ name: labels.shipping ?? 'Frakt', amountOre: this.p.shippingOre });
    if (this.p.platformFeeOre > 0) out.push({ name: labels.fee, amountOre: this.p.platformFeeOre });
    return out;
  }

  // ── Domain factories (the ONLY home for the fee formulas) ────────────────

  /** Listing purchase: buyer pays item + shipping + the trygg-betaling fee;
   *  the seller receives item + shipping; the platform keeps the TB fee. */
  static listingPurchase(input: { priceNok: number; shippingNok: number }): MoneyBreakdown {
    const itemOre = krToOre(input.priceNok);
    const shippingOre = krToOre(input.shippingNok);
    const platformFeeOre = krToOre(tbFeeForPrice(input.priceNok));
    return new MoneyBreakdown('listing_purchase', {
      itemOre,
      shippingOre,
      platformFeeOre,
      sellerCreditOre: itemOre + shippingOre,
      buyerChargeOre: itemOre + shippingOre + platformFeeOre,
    });
  }

  /** Commission payment: buyer pays the knit price + fee on top; the knitter
   *  receives the FULL price; the platform keeps the fee. No shipping here. */
  static commissionPayment(input: { priceNok: number }): MoneyBreakdown {
    const itemOre = krToOre(input.priceNok);
    const platformFeeOre = krToOre(commissionFeeNok(input.priceNok));
    return new MoneyBreakdown('commission_payment', {
      itemOre,
      shippingOre: 0,
      platformFeeOre,
      sellerCreditOre: itemOre,
      buyerChargeOre: itemOre + platformFeeOre,
    });
  }
}
