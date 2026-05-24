// Shipping options + Trygg betaling fee tiers. Single source of truth
// referenced by the listing creator (presents the choice), the listing
// detail page (shows the breakdown to a buyer), and the purchase server
// (adds line items to Stripe Checkout).

export type ShippingOption = 'free' | 'small_letter' | 'small_parcel' | 'parcel';

export interface ShippingTier {
  id: ShippingOption;
  label: string;
  description: string;
  // Approx Bring/Posten rates as of 2026. Locked onto the listing when
  // saved so changes here don't retroactively affect open orders.
  priceNok: number;
  weightLimitGrams: number | null;
}

// Prices reflect Posten's 2026 consumer rates (Norgespakke from
// posten.no/priser, brev from current consumer tariff). When the rates
// change we update this table; existing listings carry the price they
// were saved with (shipping_price_nok), so re-pricing isn't retroactive.
export const SHIPPING_TIERS: ShippingTier[] = [
  {
    id: 'free',
    label: 'Gratis frakt',
    description: 'Selger dekker frakten — kjøper betaler kun varen + trygg betaling.',
    priceNok: 0,
    weightLimitGrams: null,
  },
  {
    id: 'small_letter',
    label: 'Brev — under 350 g',
    description: 'Babysokker, votter, lue. Sendes i konvolutt med Posten Brev.',
    priceNok: 41,
    weightLimitGrams: 350,
  },
  {
    id: 'small_parcel',
    label: 'Norgespakke liten — under 5 kg',
    description: 'Cardigan, genser, mindre tepper. Hentes på utleveringssted (35 × 25 × 12 cm).',
    priceNok: 76,
    weightLimitGrams: 5000,
  },
  {
    id: 'parcel',
    label: 'Norgespakke stor — under 10 kg',
    description: 'Store tepper, ulldresser eller flere plagg samlet (inntil 120 × 60 × 60 cm).',
    priceNok: 140,
    weightLimitGrams: 10000,
  },
];

const SHIPPING_BY_ID = new Map(SHIPPING_TIERS.map(t => [t.id, t]));

export function shippingTier(id: ShippingOption | null | undefined): ShippingTier | null {
  if (!id) return null;
  return SHIPPING_BY_ID.get(id) ?? null;
}

/** Trygg betaling fee paid by the BUYER at checkout. Scales with item
 *  price so very-low-value items aren't priced out of escrow. */
export function tbFeeForPrice(priceNok: number): number {
  if (priceNok <= 0) return 0;
  if (priceNok <= 200) return 9;
  if (priceNok <= 500) return 19;
  return 29;
}

/** Full buyer-side breakdown for a listing purchase. */
export interface PurchaseBreakdown {
  itemNok: number;
  shippingNok: number;
  tbFeeNok: number;
  totalNok: number;
  shippingLabel: string;
}

export function purchaseBreakdown(
  priceNok: number,
  shippingOption: ShippingOption | null | undefined,
  tbEnabled: boolean,
): PurchaseBreakdown {
  const tier = shippingTier(shippingOption) ?? SHIPPING_TIERS[0];
  const shipping = tier.priceNok;
  const tb = tbEnabled ? tbFeeForPrice(priceNok) : 0;
  return {
    itemNok: priceNok,
    shippingNok: shipping,
    tbFeeNok: tb,
    totalNok: priceNok + shipping + tb,
    shippingLabel: tier.label,
  };
}
