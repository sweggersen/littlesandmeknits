// Commission ("Strikk for meg") pricing. Pure (no I/O) so both the service
// layer and Astro components can import it without pulling server deps.
//
// Fee model (per terms §5): the platform fee is paid by the BUYER on top of the
// knitter's quote — the knitter keeps 100% of their price, exactly like item
// sales where the buyer pays the trygg-betaling fee and the seller keeps the
// full amount. Buyer pays price + fee; at delivery the knitter is transferred
// the full price and the platform retains the fee.

export const COMMISSION_FEE_PERCENT = 8;

/** Platform fee in NOK for a commission of `priceNok` (rounded). */
export function commissionFeeNok(priceNok: number): number {
  if (priceNok <= 0) return 0;
  return Math.round(priceNok * COMMISSION_FEE_PERCENT / 100);
}

export interface CommissionBreakdown {
  priceNok: number;   // the knitter's quote — they receive this in full
  feeNok: number;     // Strikketorget fee, paid by the buyer on top
  totalNok: number;   // what the buyer pays at checkout
}

export function commissionBreakdown(priceNok: number): CommissionBreakdown {
  const feeNok = commissionFeeNok(priceNok);
  return { priceNok, feeNok, totalNok: priceNok + feeNok };
}
