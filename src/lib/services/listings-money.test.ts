import { describe, it, expect, vi, beforeEach } from 'vitest';
import { purchaseListing, confirmListingDelivery, completeListingPurchase } from './listings';
import { createNotification } from '../notify';
import { tbFeeForPrice } from '../shipping';
import { createFakeDb, type FakeDb } from './__test_helpers__/fake-db';
import type { ServiceContext } from './types';

// Projection on: reads return only selected columns, so a dropped/blanked
// `.select(...)` surfaces as a missing field (kills column-list mutants).
const fakeDb = (seed: Record<string, Record<string, unknown>[]>) =>
  createFakeDb(seed, { projectColumns: true });

// R2-15+ — money-math + side-effect coverage for the listing buy flow,
// backed by the in-memory fake (fake-db.ts). Because the fake actually
// applies eq/is/in filters against seeded rows, a service that queried the
// wrong row would get null and fail these tests automatically — the
// assertions below verify the real numbers Stripe is told to charge.

vi.mock('../notify', () => ({
  createNotification: vi.fn(),
  notifyModeratorsNewItem: vi.fn(),
  notifyFollowersOfNewListing: vi.fn(),
}));
vi.mock('./dead-letter', () => ({ recordDeadLetter: vi.fn() }));

const checkoutCreate = vi.fn(async (_args?: any) => ({ url: 'https://checkout.stripe.com/c/test_123' }));
const piCapture = vi.fn(async (_id?: any) => ({}));
const piRetrieve = vi.fn(async (_id?: any) => ({ status: 'requires_capture' }));
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({
    checkout: { sessions: { create: checkoutCreate } },
    paymentIntents: { capture: piCapture, retrieve: piRetrieve },
  })),
}));

beforeEach(() => {
  checkoutCreate.mockClear();
  piCapture.mockClear();
  vi.mocked(createNotification).mockClear();
});

function ctxFor(db: FakeDb, userId = 'buyer-1', email = 'buyer@x.io'): ServiceContext {
  return {
    supabase: db.client as any,
    admin: db.client as any,
    user: { id: userId, email },
    env: { STRIPE_SECRET_KEY: 'sk_test', PUBLIC_SITE_URL: 'https://test.site' } as any,
  };
}

function checkoutArgs(): any {
  expect(checkoutCreate).toHaveBeenCalledTimes(1);
  return checkoutCreate.mock.calls[0][0];
}

/** Seed a personal-seller listing + the seller's profile rows. */
function seedPersonal(listingOverrides: Record<string, unknown> = {}, role = 'user') {
  return fakeDb({
    listings: [{
      id: 'l1', seller_id: 'seller-1', store_id: null,
      title: 'Babygenser', price_nok: 500, status: 'active',
      hero_photo_path: null, escrow_enabled: true,
      shipping_option: 'small_parcel', shipping_price_nok: 76,
      ...listingOverrides,
    }],
    profiles: [{ id: 'seller-1', role }],
    seller_profiles: [{ id: 'seller-1', stripe_account_id: 'acct_seller', stripe_connect_status: 'verified' }],
  });
}

describe('purchaseListing — personal seller money math', () => {
  it('charges item + shipping + TB fee, application fee = 13% of item + TB fee', async () => {
    const db = seedPersonal();
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(true);

    const args = checkoutArgs();
    // price 500 -> 50000 ore; shipping 76 -> 7600; TB fee for 500 = 19 -> 1900.
    const amounts = args.line_items.map((li: any) => li.price_data.unit_amount);
    expect(amounts).toEqual([50000, 7600, 1900]);
    // application_fee = 13% of 50000 (=6500) + TB fee 1900 = 8400.
    expect(args.payment_intent_data.application_fee_amount).toBe(8400);
    expect(args.payment_intent_data.transfer_data.destination).toBe('acct_seller');
    expect(args.payment_intent_data.capture_method).toBe('manual');
    // The Stripe-hosted Checkout URL is handed back to the caller.
    if (r.ok) expect(r.data.checkoutUrl).toBe('https://checkout.stripe.com/c/test_123');
  });

  it('ambassador seller pays 8% commission, free shipping omits the shipping line', async () => {
    const db = seedPersonal({ price_nok: 1000, shipping_option: 'free', shipping_price_nok: 0 }, 'ambassador');
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(true);

    const args = checkoutArgs();
    const amounts = args.line_items.map((li: any) => li.price_data.unit_amount);
    expect(amounts).toEqual([100000, 2900]); // item + TB only
    expect(args.payment_intent_data.application_fee_amount).toBe(10900); // 8000 + 2900
  });

  it('stamps metadata with buyer, seller, TB and shipping amounts', async () => {
    const db = seedPersonal();
    await purchaseListing(ctxFor(db, 'buyer-9'), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    const args = checkoutArgs();
    expect(args.metadata).toEqual({
      type: 'listing_purchase', listing_id: 'l1', buyer_id: 'buyer-9',
      seller_id: 'seller-1', tb_fee_nok: '19', shipping_nok: '76', store_id: '',
    });
    expect(args.client_reference_id).toBe('buyer-9');
  });

  it('builds the full Checkout session: mode, methods, address, URLs, locale, line-item names', async () => {
    const db = seedPersonal();
    await purchaseListing(ctxFor(db, 'buyer-9', 'kari@x.io'), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    const args = checkoutArgs();
    expect(args.mode).toBe('payment');
    expect(args.payment_method_types).toEqual(['vipps', 'card']);
    expect(args.shipping_address_collection).toEqual({ allowed_countries: ['NO'] });
    expect(args.success_url).toBe('https://test.site/market/listing/l1?purchased=1');
    expect(args.cancel_url).toBe('https://test.site/market/listing/l1');
    expect(args.customer_email).toBe('kari@x.io');
    expect(args.locale).toBe('nb');
    // Line-item display names (item / shipping tier / TB fee).
    const names = args.line_items.map((li: any) => li.price_data.product_data.name);
    expect(names[0]).toBe('Babygenser');
    expect(names[1]).toContain('Frakt');
    expect(names[2]).toBe('Trygg betaling');
    // Every line is NOK, quantity 1.
    for (const li of args.line_items) {
      expect(li.price_data.currency).toBe('nok');
      expect(li.quantity).toBe(1);
    }
  });

  it('omits the TB line when the TB fee is zero (price 0)', async () => {
    const db = seedPersonal({ price_nok: 0, shipping_option: 'free', shipping_price_nok: 0 });
    await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    const args = checkoutArgs();
    // Only the item line; no shipping, no TB.
    expect(args.line_items).toHaveLength(1);
    expect(args.payment_intent_data.application_fee_amount).toBe(0);
  });

  it('falls back to the canonical site URL when PUBLIC_SITE_URL is unset', async () => {
    const db = seedPersonal();
    const ctx = ctxFor(db);
    (ctx.env as any).PUBLIC_SITE_URL = undefined;
    await purchaseListing(ctx, { listingId: 'l1', stripeSecretKey: 'sk_test' });
    const args = checkoutArgs();
    expect(args.success_url).toBe('https://www.littlesandmeknits.com/market/listing/l1?purchased=1');
    expect(args.cancel_url).toBe('https://www.littlesandmeknits.com/market/listing/l1');
  });

  it('labels the shipping line "sending" when the tier is unknown', async () => {
    // Legacy row: a shipping_option not in the current tier table, with a
    // locked-in price. The line still shows, with the generic fallback label.
    const db = seedPersonal({ shipping_option: 'legacy_tier', shipping_price_nok: 60 });
    await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    const args = checkoutArgs();
    const shippingLine = args.line_items[1];
    expect(shippingLine.price_data.unit_amount).toBe(6000);
    expect(shippingLine.price_data.product_data.name).toBe('Frakt (sending)');
  });

  it('falls back to the tier default price when shipping_price_nok is null', async () => {
    // Legacy row with no locked price; falls back to the tier table (small_parcel = 76).
    const db = seedPersonal({ shipping_option: 'small_parcel', shipping_price_nok: null });
    await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    const args = checkoutArgs();
    expect(args.line_items[1].price_data.unit_amount).toBe(7600);
  });

  it('uses zero shipping when price is unset and the tier is unknown', async () => {
    // Both fallbacks empty: no locked price AND an unknown tier -> 0, no line.
    const db = seedPersonal({ shipping_option: 'legacy', shipping_price_nok: null });
    await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    const amounts = checkoutArgs().line_items.map((li: any) => li.price_data.unit_amount);
    expect(amounts).toEqual([50000, 1900]); // item 500 + TB 19, no shipping line
  });

  it('not_found when the seller profile is missing', async () => {
    const db = fakeDb({
      listings: [{
        id: 'l1', seller_id: 'seller-1', store_id: null, title: 'X', price_nok: 500,
        status: 'active', hero_photo_path: null, escrow_enabled: true,
        shipping_option: 'free', shipping_price_nok: 0,
      }],
      // No profiles row for seller-1.
      seller_profiles: [{ id: 'seller-1', stripe_account_id: 'acct', stripe_connect_status: 'verified' }],
    });
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('not_found'); expect(r.message).toBeTruthy(); }
    expect(checkoutCreate).not.toHaveBeenCalled();
  });
});

describe('purchaseListing — escrow split reconciles (money conservation)', () => {
  // The invariant that ties it all together: what the buyer pays, minus what
  // the platform keeps (application fee), must equal what the seller nets
  // (item + shipping passthrough - commission). If shipping were ever
  // double-counted into the fee, or the TB fee leaked to the seller, this
  // breaks even when the individual-number tests pass.
  it.each([
    ['small_parcel', 76, 'user', 13],
    ['free', 0, 'user', 13],
    ['parcel', 140, 'ambassador', 8],
  ])('shipping=%s seller=%s', async (shipping_option, shippingNok, role, pct) => {
    const db = seedPersonal({ price_nok: 800, shipping_option, shipping_price_nok: shippingNok }, role);
    await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    const args = checkoutArgs();

    const itemOre = 800 * 100;
    const shipOre = shippingNok * 100;
    const tbOre = tbFeeForPrice(800) * 100;
    const commission = Math.round(itemOre * pct / 100);

    const buyerTotal = args.line_items.reduce((s: number, li: any) => s + li.price_data.unit_amount * li.quantity, 0);
    const appFee = args.payment_intent_data.application_fee_amount;

    // Buyer pays item + shipping + TB.
    expect(buyerTotal).toBe(itemOre + shipOre + tbOre);
    // Platform keeps commission + TB fee.
    expect(appFee).toBe(commission + tbOre);
    // Seller nets item + shipping - commission (no TB leakage).
    expect(buyerTotal - appFee).toBe(itemOre + shipOre - commission);
    // Sanity: the platform never takes more than the buyer pays.
    expect(appFee).toBeLessThan(buyerTotal);
  });

  // Price sweep — rounding bugs hide at boundaries the hand-picked cases miss.
  it.each([1, 50, 199, 200, 201, 499, 500, 501, 999, 1000, 4999, 5000])(
    'fee math holds at price %d kr (personal, 13%%, free shipping)',
    async (price) => {
      const db = seedPersonal({ price_nok: price, shipping_option: 'free', shipping_price_nok: 0 });
      await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
      const args = checkoutArgs();

      const itemOre = price * 100;
      const tbOre = tbFeeForPrice(price) * 100;
      const expectedFee = Math.round(itemOre * 13 / 100) + tbOre;

      expect(args.payment_intent_data.application_fee_amount).toBe(expectedFee);
      const buyerTotal = args.line_items.reduce((s: number, li: any) => s + li.price_data.unit_amount, 0);
      expect(buyerTotal).toBe(itemOre + tbOre);
      expect(expectedFee).toBeLessThanOrEqual(buyerTotal);
    },
  );
});

describe('purchaseListing — store-owned tier fees', () => {
  function seedStore(tier: string | undefined) {
    return fakeDb({
      listings: [{
        id: 'l1', seller_id: 'seller-1', store_id: 'store-1',
        title: 'Genser', price_nok: 600, status: 'active', hero_photo_path: null,
        escrow_enabled: true, shipping_option: 'free', shipping_price_nok: 0,
      }],
      stores: [{ id: 'store-1', stripe_account_id: 'acct_store', stripe_onboarded: true, tier, status: 'active' }],
    });
  }

  it.each([
    ['starter', 15], ['pro', 14], ['elite', 13], [undefined, 15],
  ])('tier=%s applies %d%% commission', async (tier, pct) => {
    const db = seedStore(tier);
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(true);
    const args = checkoutArgs();
    const expectedFee = Math.round(60000 * pct / 100) + 2900; // TB for 600 = 29
    expect(args.payment_intent_data.application_fee_amount).toBe(expectedFee);
    expect(args.payment_intent_data.transfer_data.destination).toBe('acct_store');
  });
});

describe('purchaseListing — guards', () => {
  it('rejects empty listing id', async () => {
    const db = seedPersonal();
    const r = await purchaseListing(ctxFor(db), { listingId: '', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('bad_input'); expect(r.message).toBeTruthy(); }
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('server_error when no Stripe secret key is supplied', async () => {
    const db = seedPersonal();
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('server_error'); expect(r.message).toBeTruthy(); }
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('server_error when Stripe returns a session without a URL', async () => {
    checkoutCreate.mockResolvedValueOnce({ url: null } as any);
    const db = seedPersonal();
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('server_error'); expect(r.message).toBeTruthy(); }
  });

  it('conflict when the seller payout-connect row is missing entirely', async () => {
    const db = fakeDb({
      listings: [{
        id: 'l1', seller_id: 'seller-1', store_id: null, title: 'X', price_nok: 500,
        status: 'active', hero_photo_path: null, escrow_enabled: true,
        shipping_option: 'free', shipping_price_nok: 0,
      }],
      profiles: [{ id: 'seller-1', role: 'user' }],
      // No seller_profiles row -> sellerConnect is null.
    });
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('not_found when listing missing', async () => {
    const db = fakeDb({ listings: [] });
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('not_found'); expect(r.message).toBeTruthy(); }
  });

  it('conflict when listing not active', async () => {
    const db = seedPersonal({ status: 'sold' });
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('conflict'); expect(r.message).toBeTruthy(); }
  });

  it('rejects buying your own listing', async () => {
    const db = seedPersonal();
    const r = await purchaseListing(ctxFor(db, 'seller-1'), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('bad_input'); expect(r.message).toBeTruthy(); }
  });

  it('conflict when escrow not enabled', async () => {
    const db = seedPersonal({ escrow_enabled: false });
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('conflict'); expect(r.message).toBeTruthy(); }
  });

  it('conflict when seller not onboarded to Stripe (status not verified)', async () => {
    const db = fakeDb({
      listings: [{
        id: 'l1', seller_id: 'seller-1', store_id: null, title: 'X', price_nok: 500,
        status: 'active', hero_photo_path: null, escrow_enabled: true,
        shipping_option: 'free', shipping_price_nok: 0,
      }],
      profiles: [{ id: 'seller-1', role: 'user' }],
      seller_profiles: [{ id: 'seller-1', stripe_account_id: 'acct_x', stripe_connect_status: 'pending' }],
    });
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('conflict'); expect(r.message).toBeTruthy(); }
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('conflict when seller is verified but has no payout account id', async () => {
    const db = fakeDb({
      listings: [{
        id: 'l1', seller_id: 'seller-1', store_id: null, title: 'X', price_nok: 500,
        status: 'active', hero_photo_path: null, escrow_enabled: true,
        shipping_option: 'free', shipping_price_nok: 0,
      }],
      profiles: [{ id: 'seller-1', role: 'user' }],
      seller_profiles: [{ id: 'seller-1', stripe_account_id: null, stripe_connect_status: 'verified' }],
    });
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('conflict'); expect(r.message).toBeTruthy(); }
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('conflict when the store is not active', async () => {
    const db = fakeDb({
      listings: [{
        id: 'l1', seller_id: 'seller-1', store_id: 'store-1', title: 'X', price_nok: 500,
        status: 'active', hero_photo_path: null, escrow_enabled: true,
        shipping_option: 'free', shipping_price_nok: 0,
      }],
      stores: [{ id: 'store-1', stripe_account_id: 'acct_store', stripe_onboarded: true, tier: 'pro', status: 'suspended' }],
    });
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('conflict'); expect(r.message).toBeTruthy(); }
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('conflict when the store has not finished Stripe onboarding', async () => {
    const db = fakeDb({
      listings: [{
        id: 'l1', seller_id: 'seller-1', store_id: 'store-1', title: 'X', price_nok: 500,
        status: 'active', hero_photo_path: null, escrow_enabled: true,
        shipping_option: 'free', shipping_price_nok: 0,
      }],
      stores: [{ id: 'store-1', stripe_account_id: 'acct_store', stripe_onboarded: false, tier: 'pro', status: 'active' }],
    });
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('conflict'); expect(r.message).toBeTruthy(); }
    expect(checkoutCreate).not.toHaveBeenCalled();
  });
});

describe('completeListingPurchase (webhook transition)', () => {
  const FIXED = new Date('2026-06-02T12:00:00.000Z');
  function seedActive(overrides: Record<string, unknown> = {}) {
    return fakeDb({
      listings: [{
        id: 'l1', seller_id: 'seller-1', buyer_id: null, status: 'active',
        title: 'Babygenser', stripe_payment_intent_id: null, platform_fee_nok: null,
        reserved_at: null, auto_release_at: null,
        buyer_name: null, buyer_address: null, buyer_postal_code: null, buyer_city: null,
        ...overrides,
      }],
    });
  }

  it('transitions active -> reserved and records buyer, PI, fee, shipping', async () => {
    const db = seedActive();
    const res = await completeListingPurchase(db.client as any, {
      listingId: 'l1', buyerId: 'buyer-1', paymentIntentId: 'pi_xyz',
      amountTotalOre: 56900, // 569 kr total -> fee round(56900*0.13/100) = 74
      shipping: { name: 'Kari', line1: 'Storgata 1', postalCode: '0001', city: 'Oslo' },
      now: FIXED,
    });
    expect(res.updated).toBe(true);
    expect(res.listing).toMatchObject({ seller_id: 'seller-1', title: 'Babygenser' });

    const row = db.find('listings', { id: 'l1' }) as any;
    expect(row.status).toBe('reserved');
    expect(row.buyer_id).toBe('buyer-1');
    expect(row.stripe_payment_intent_id).toBe('pi_xyz');
    expect(row.platform_fee_nok).toBe(74);
    expect(row.reserved_at).toBe(FIXED.toISOString());
    // auto-release defaults to +21 days.
    expect(row.auto_release_at).toBe(new Date(FIXED.getTime() + 21 * 86400_000).toISOString());
    expect(row).toMatchObject({
      buyer_name: 'Kari', buyer_address: 'Storgata 1',
      buyer_postal_code: '0001', buyer_city: 'Oslo',
    });
  });

  it('is idempotent: a duplicate delivery does not re-transition or re-notify', async () => {
    const db = seedActive();
    const first = await completeListingPurchase(db.client as any, {
      listingId: 'l1', buyerId: 'buyer-1', paymentIntentId: 'pi_xyz', amountTotalOre: 56900, now: FIXED,
    });
    expect(first.updated).toBe(true);

    // Second Stripe delivery of the same event — status is no longer active.
    const second = await completeListingPurchase(db.client as any, {
      listingId: 'l1', buyerId: 'buyer-1', paymentIntentId: 'pi_xyz', amountTotalOre: 56900, now: FIXED,
    });
    expect(second.updated).toBe(false);
    expect(second.listing).toBeNull(); // caller skips the duplicate notification
  });

  it('does not touch a listing that is not active', async () => {
    const db = seedActive({ status: 'sold', buyer_id: 'old-buyer' });
    const res = await completeListingPurchase(db.client as any, {
      listingId: 'l1', buyerId: 'attacker', paymentIntentId: 'pi_x', amountTotalOre: 10000, now: FIXED,
    });
    expect(res.updated).toBe(false);
    expect((db.find('listings', { id: 'l1' }) as any).buyer_id).toBe('old-buyer');
  });

  it('zero amount_total yields a zero fee', async () => {
    const db = seedActive();
    await completeListingPurchase(db.client as any, {
      listingId: 'l1', buyerId: 'buyer-1', paymentIntentId: null, amountTotalOre: null, now: FIXED,
    });
    expect((db.find('listings', { id: 'l1' }) as any).platform_fee_nok).toBe(0);
  });

  it('surfaces a DB error (no transition, no listing) so the webhook can dead-letter', async () => {
    const db = createFakeDb(
      { listings: [{ id: 'l1', seller_id: 'seller-1', status: 'active', title: 'X' }] },
      { projectColumns: true, updateError: { listings: { message: 'deadlock' } } },
    );
    const res = await completeListingPurchase(db.client as any, {
      listingId: 'l1', buyerId: 'buyer-1', paymentIntentId: 'pi', amountTotalOre: 10000, now: FIXED,
    });
    expect(res.updated).toBe(false);
    expect(res.listing).toBeNull();
    expect(res.error).toMatchObject({ message: 'deadlock' });
  });
});

describe('confirmListingDelivery', () => {
  function seedShipped(overrides: Record<string, unknown> = {}) {
    return fakeDb({
      listings: [{
        id: 'l1', seller_id: 'seller-1', buyer_id: 'buyer-1',
        title: 'Babygenser', status: 'shipped', stripe_payment_intent_id: 'pi_abc',
        ...overrides,
      }],
    });
  }

  it('captures the same PI the buy created, marks sold + delivered (real row state)', async () => {
    const db = seedShipped();
    const r = await confirmListingDelivery(ctxFor(db, 'buyer-1'), { listingId: 'l1' });
    expect(r.ok).toBe(true);
    expect(piCapture).toHaveBeenCalledWith('pi_abc');

    // Assert the actual mutated row, not just a recorded payload.
    const row = db.find('listings', { id: 'l1' }) as any;
    expect(row.status).toBe('sold');
    expect(row.auto_release_at).toBeNull();
    expect(row.sold_at).toBe(row.delivered_at);
    expect(typeof row.sold_at).toBe('string');
    if (r.ok) expect(r.data.redirect).toBe('/market/listing/l1');
  });

  it('notifies the seller with the delivery-confirmed message (body names the item)', async () => {
    const db = seedShipped();
    await confirmListingDelivery(ctxFor(db, 'buyer-1'), { listingId: 'l1' });
    expect(createNotification).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(createNotification).mock.calls[0];
    expect(payload).toMatchObject({
      userId: 'seller-1', type: 'listing_delivered', title: 'Levering bekreftet!',
      url: '/market/listing/l1', actorId: 'buyer-1', referenceId: 'l1',
    });
    expect((payload as any).body).toContain('Babygenser');
    expect((payload as any).body).toContain('Betalingen frigis');
  });

  it('forbids a non-buyer confirming delivery (row untouched)', async () => {
    const db = seedShipped();
    const r = await confirmListingDelivery(ctxFor(db, 'someone-else'), { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('not_found'); expect(r.message).toBeTruthy(); }
    expect(piCapture).not.toHaveBeenCalled();
    expect((db.find('listings', { id: 'l1' }) as any).status).toBe('shipped');
  });

  it('rejects confirming in a non-shipped/reserved state', async () => {
    const db = seedShipped({ status: 'sold' });
    const r = await confirmListingDelivery(ctxFor(db, 'buyer-1'), { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('conflict'); expect(r.message).toBeTruthy(); }
  });

  it('also confirms from the reserved state (buyer never waited for shipping)', async () => {
    const db = seedShipped({ status: 'reserved' });
    const r = await confirmListingDelivery(ctxFor(db, 'buyer-1'), { listingId: 'l1' });
    expect(r.ok).toBe(true);
    expect((db.find('listings', { id: 'l1' }) as any).status).toBe('sold');
  });

  it('does not notify when the listing has no seller_id', async () => {
    const db = seedShipped({ seller_id: null });
    const r = await confirmListingDelivery(ctxFor(db, 'buyer-1'), { listingId: 'l1' });
    expect(r.ok).toBe(true);
    expect(createNotification).not.toHaveBeenCalled();
    // The sale still completes.
    expect((db.find('listings', { id: 'l1' }) as any).status).toBe('sold');
  });

  it('skips capture when there is no payment intent (free/legacy) but still marks sold', async () => {
    const db = seedShipped({ stripe_payment_intent_id: null });
    const r = await confirmListingDelivery(ctxFor(db, 'buyer-1'), { listingId: 'l1' });
    expect(r.ok).toBe(true);
    expect(piCapture).not.toHaveBeenCalled();
    expect((db.find('listings', { id: 'l1' }) as any).status).toBe('sold');
  });
});
