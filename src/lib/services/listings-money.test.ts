import { describe, it, expect, vi, beforeEach } from 'vitest';
import { purchaseListing, confirmListingDelivery, completeListingPurchase, releaseExpiredReservation, shipListing } from './listings';
import { createNotification } from '../notify';
import { recordDeadLetter } from './dead-letter';
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
const piCancel = vi.fn(async (_id?: any) => ({ status: 'canceled' }));
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({
    checkout: { sessions: { create: checkoutCreate } },
    paymentIntents: { capture: piCapture, retrieve: piRetrieve, cancel: piCancel },
  })),
}));

beforeEach(() => {
  checkoutCreate.mockClear();
  piCapture.mockClear();
  piRetrieve.mockClear();
  piCancel.mockClear();
  vi.mocked(recordDeadLetter).mockClear();
  vi.mocked(createNotification).mockClear();
});

const RELEASE_ENV = { STRIPE_SECRET_KEY: 'sk_test', PUBLIC_SITE_URL: 'https://test.site', RESEND_API_KEY: '', PUBLIC_VAPID_KEY: '', VAPID_PRIVATE_KEY: '' } as any;

/** Seed a reserved-but-not-shipped listing holding an uncaptured auth. */
function seedReserved(overrides: Record<string, unknown> = {}): FakeDb {
  const status = (overrides.status as string) ?? 'reserved';
  // The PI lives on the ORDER now, so a `stripe_payment_intent_id` override
  // applies there (a null override = legacy/free purchase).
  const pi = 'stripe_payment_intent_id' in overrides ? overrides.stripe_payment_intent_id : 'pi_hold';
  return fakeDb({
    listings: [{ id: 'l1', seller_id: 'seller-1', buyer_id: 'buyer-1', title: 'Babygenser', status }],
    // The open order is the source of truth (PII + money + lifecycle).
    orders: [{
      id: 'o1', listing_id: 'l1', buyer_id: 'buyer-1', seller_id: 'seller-1',
      status, item_price_nok: 500, stripe_payment_intent_id: pi,
      shipping_name: 'Kari', shipping_address: 'Storgata 1', shipping_postal_code: '0001', shipping_city: 'Oslo',
      reserved_at: '2026-01-01T00:00:00.000Z',
      ship_deadline_at: '2026-01-06T00:00:00.000Z', auto_release_at: null,
    }],
  });
}

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
  it('charges item + shipping + TB fee; application fee = TB fee ONLY (0% seller commission)', async () => {
    const db = seedPersonal();
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(true);

    const args = checkoutArgs();
    // price 500 -> 50000 ore; shipping 76 -> 7600; TB fee for 500 = 19 -> 1900.
    const amounts = args.line_items.map((li: any) => li.price_data.unit_amount);
    expect(amounts).toEqual([50000, 7600, 1900]);
    // H4 launch model: no item commission — the platform keeps the TB fee only,
    // the seller receives the full item price + shipping.
    expect(args.payment_intent_data.application_fee_amount).toBe(1900);
    expect(args.payment_intent_data.transfer_data.destination).toBe('acct_seller');
    expect(args.payment_intent_data.capture_method).toBe('manual');
    // The Stripe-hosted Checkout URL is handed back to the caller.
    if (r.ok) expect(r.data.checkoutUrl).toBe('https://checkout.stripe.com/c/test_123');
  });

  it('free shipping omits the shipping line; fee still TB only', async () => {
    const db = seedPersonal({ price_nok: 1000, shipping_option: 'free', shipping_price_nok: 0 });
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(true);

    const args = checkoutArgs();
    const amounts = args.line_items.map((li: any) => li.price_data.unit_amount);
    expect(amounts).toEqual([100000, 2900]); // item + TB only
    expect(args.payment_intent_data.application_fee_amount).toBe(2900); // TB fee for 1000 kr
  });

  it('stamps metadata with buyer, seller, TB, shipping and the EXACT fee', async () => {
    const db = seedPersonal();
    await purchaseListing(ctxFor(db, 'buyer-9'), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    const args = checkoutArgs();
    expect(args.metadata).toEqual({
      type: 'listing_purchase', listing_id: 'l1', buyer_id: 'buyer-9',
      seller_id: 'seller-1', tb_fee_nok: '19', shipping_nok: '76',
      platform_fee_ore: '1900', store_id: '',
    });
    // H3 invariant: the metadata fee IS the application fee, so the webhook
    // records exactly what Stripe charged (no recomputation drift).
    expect(args.metadata.platform_fee_ore).toBe(String(args.payment_intent_data.application_fee_amount));
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

  it('succeeds without a profiles row (role no longer affects the fee)', async () => {
    const db = fakeDb({
      listings: [{
        id: 'l1', seller_id: 'seller-1', store_id: null, title: 'X', price_nok: 500,
        status: 'active', hero_photo_path: null, escrow_enabled: true,
        shipping_option: 'free', shipping_price_nok: 0,
      }],
      // No profiles row for seller-1 — only the payout connect row matters now.
      seller_profiles: [{ id: 'seller-1', stripe_account_id: 'acct', stripe_connect_status: 'verified' }],
    });
    const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(true);
    expect(checkoutArgs().payment_intent_data.application_fee_amount).toBe(1900); // TB only
  });
});

describe('purchaseListing — escrow split reconciles (money conservation)', () => {
  // The invariant that ties it all together: what the buyer pays, minus what
  // the platform keeps (application fee = the TB fee only, 0% commission),
  // must equal what the seller nets (full item + shipping passthrough). If
  // shipping were ever counted into the fee, or the TB fee leaked to the
  // seller, this breaks even when the individual-number tests pass.
  it.each([
    ['small_parcel', 76],
    ['free', 0],
    ['parcel', 140],
  ])('shipping=%s reconciles', async (shipping_option, shippingNok) => {
    const db = seedPersonal({ price_nok: 800, shipping_option, shipping_price_nok: shippingNok });
    await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    const args = checkoutArgs();

    const itemOre = 800 * 100;
    const shipOre = (shippingNok as number) * 100;
    const tbOre = tbFeeForPrice(800) * 100;

    const buyerTotal = args.line_items.reduce((s: number, li: any) => s + li.price_data.unit_amount * li.quantity, 0);
    const appFee = args.payment_intent_data.application_fee_amount;

    // Buyer pays item + shipping + TB.
    expect(buyerTotal).toBe(itemOre + shipOre + tbOre);
    // Platform keeps the TB fee only.
    expect(appFee).toBe(tbOre);
    // Seller nets the FULL item + shipping (0% commission, no TB leakage).
    expect(buyerTotal - appFee).toBe(itemOre + shipOre);
    // Sanity: the platform never takes more than the buyer pays.
    expect(appFee).toBeLessThan(buyerTotal);
  });

  // Price sweep — the TB tiers step at 200/500 kr; boundaries are where
  // off-by-one bugs hide.
  it.each([1, 50, 199, 200, 201, 499, 500, 501, 999, 1000, 4999, 5000])(
    'fee = exactly the TB tier at price %d kr (free shipping)',
    async (price) => {
      const db = seedPersonal({ price_nok: price, shipping_option: 'free', shipping_price_nok: 0 });
      await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
      const args = checkoutArgs();

      const itemOre = price * 100;
      const tbOre = tbFeeForPrice(price) * 100;

      expect(args.payment_intent_data.application_fee_amount).toBe(tbOre);
      const buyerTotal = args.line_items.reduce((s: number, li: any) => s + li.price_data.unit_amount, 0);
      expect(buyerTotal).toBe(itemOre + tbOre);
      // Seller share is exactly the item price.
      expect(buyerTotal - args.payment_intent_data.application_fee_amount).toBe(itemOre);
    },
  );
});

describe('purchaseListing — store-owned listings', () => {
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

  it.each([['starter'], ['pro'], ['elite'], [undefined]])(
    'tier=%s: fee is the TB fee only, payment routes to the store account',
    async (tier) => {
      const db = seedStore(tier as string | undefined);
      const r = await purchaseListing(ctxFor(db), { listingId: 'l1', stripeSecretKey: 'sk_test' });
      expect(r.ok).toBe(true);
      const args = checkoutArgs();
      expect(args.payment_intent_data.application_fee_amount).toBe(2900); // TB for 600 = 29
      expect(args.payment_intent_data.transfer_data.destination).toBe('acct_store');
    },
  );
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

  it('falls back to the production site URL when PUBLIC_SITE_URL is unset', async () => {
    const db = seedPersonal();
    const ctx = ctxFor(db);
    delete (ctx.env as any).PUBLIC_SITE_URL;
    await purchaseListing(ctx, { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(checkoutArgs().success_url).toContain('https://www.littlesandmeknits.com');
  });

  it('is blocked by the purchases kill-switch (no checkout created)', async () => {
    const db = seedPersonal();
    const ctx = ctxFor(db);
    (ctx.env as any).KILL_PURCHASES = 'on';
    const r = await purchaseListing(ctx, { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('service_unavailable');
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
        id: 'l1', seller_id: 'seller-1', store_id: null, buyer_id: null, status: 'active',
        title: 'Babygenser', price_nok: 500, stripe_payment_intent_id: null, platform_fee_nok: null,
        reserved_at: null, auto_release_at: null,
        buyer_name: null, buyer_address: null, buyer_postal_code: null, buyer_city: null,
        ...overrides,
      }],
      orders: [],
    });
  }

  it('records the EXACT fee from metadata when present (H3)', async () => {
    const db = seedActive();
    // 500 kr item @13% + 19 kr TB = 84 kr = 8400 ore. The 13%-of-total
    // estimate on this session would be 74 — proving the exact path wins.
    await completeListingPurchase(db.client as any, {
      listingId: 'l1', buyerId: 'buyer-1', paymentIntentId: 'pi_xyz',
      amountTotalOre: 56900, platformFeeOre: 8400,
      now: FIXED,
    });
    expect((db.find('orders', { listing_id: 'l1' }) as any).platform_fee_nok).toBe(84);
  });

  it('transitions active -> reserved and records buyer, PI, fee, shipping', async () => {
    const db = seedActive();
    const res = await completeListingPurchase(db.client as any, {
      listingId: 'l1', buyerId: 'buyer-1', paymentIntentId: 'pi_xyz',
      amountTotalOre: 56900, // legacy estimate path: round(56900*0.13/100) = 74
      shipping: { name: 'Kari', line1: 'Storgata 1', postalCode: '0001', city: 'Oslo' },
      now: FIXED,
    });
    expect(res.updated).toBe(true);
    expect(res.listing).toMatchObject({ seller_id: 'seller-1', title: 'Babygenser' });

    // The catalog row carries ONLY the projection (status + current holder).
    const row = db.find('listings', { id: 'l1' }) as any;
    expect(row.status).toBe('reserved');
    expect(row.buyer_id).toBe('buyer-1');
    expect(row.stripe_payment_intent_id ?? null).toBeNull(); // PI no longer on the listing

    // The order is the sole home of PII + money + lifecycle. ship_deadline_at
    // carries the 5-day deadline; the delivery-window auto_release_at is set
    // only after shipment.
    const order = db.find('orders', { listing_id: 'l1' }) as any;
    expect(order.status).toBe('reserved');
    expect(order.buyer_id).toBe('buyer-1');
    expect(order.seller_id).toBe('seller-1');
    expect(order.item_price_nok).toBe(500);
    expect(order.platform_fee_nok).toBe(74);
    expect(order.stripe_payment_intent_id).toBe('pi_xyz');
    expect(order.shipping_name).toBe('Kari');
    expect(order.shipping_address).toBe('Storgata 1');
    expect(order.shipping_postal_code).toBe('0001');
    expect(order.shipping_city).toBe('Oslo');
    expect(order.reserved_at).toBe(FIXED.toISOString());
    expect(order.ship_deadline_at).toBe(new Date(FIXED.getTime() + 5 * 86400_000).toISOString());
    expect(order.auto_release_at ?? null).toBeNull();
  });

  it('records tb fee + shipping + store on the order money breakdown', async () => {
    const db = seedActive({ store_id: 'store-9' });
    await completeListingPurchase(db.client as any, {
      listingId: 'l1', buyerId: 'buyer-1', paymentIntentId: 'pi_xyz',
      amountTotalOre: 59500, platformFeeOre: 1900, tbFeeNok: 19, shippingNok: 76,
    });
    const order = db.find('orders', { listing_id: 'l1' }) as any;
    expect(order.tb_fee_nok).toBe(19);
    expect(order.shipping_nok).toBe(76);
    expect(order.platform_fee_nok).toBe(19); // 1900 ore
    expect(order.store_id).toBe('store-9'); // store-owned order routes here
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
    expect((db.find('orders', { listing_id: 'l1' }) as any).platform_fee_nok).toBe(0);
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
    const pi = 'stripe_payment_intent_id' in overrides ? overrides.stripe_payment_intent_id : 'pi_abc';
    const status = (overrides.status as string) ?? 'shipped';
    const sellerId = 'seller_id' in overrides ? (overrides.seller_id as string | null) : 'seller-1';
    return fakeDb({
      listings: [{ id: 'l1', seller_id: sellerId, buyer_id: 'buyer-1', title: 'Babygenser', status }],
      orders: [{
        id: 'o1', listing_id: 'l1', buyer_id: 'buyer-1', seller_id: sellerId,
        status: status === 'sold' ? 'delivered' : status, item_price_nok: 500, stripe_payment_intent_id: pi,
      }],
    });
  }

  it('is blocked by the payouts kill-switch BEFORE any capture or state change', async () => {
    const db = seedShipped();
    const ctx = ctxFor(db, 'buyer-1');
    (ctx.env as any).KILL_PAYOUTS = 'on';
    const r = await confirmListingDelivery(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('service_unavailable');
    expect(piCapture).not.toHaveBeenCalled();
    // Never mark sold without having captured — must be re-confirmable later.
    expect((db.find('listings', { id: 'l1' }) as any).status).toBe('shipped');
  });

  it('captures the same PI the buy created, marks sold + delivered (real row state)', async () => {
    const db = seedShipped();
    const r = await confirmListingDelivery(ctxFor(db, 'buyer-1'), { listingId: 'l1' });
    expect(r.ok).toBe(true);
    expect(piCapture).toHaveBeenCalledWith('pi_abc');

    // Assert the actual mutated row, not just a recorded payload.
    const row = db.find('listings', { id: 'l1' }) as any;
    expect(row.status).toBe('sold');
    expect(typeof row.sold_at).toBe('string');
    if (r.ok) expect(r.data.redirect).toBe('/market/listing/l1');
    // Order delivered (terminal); the release deadline is cleared on the order.
    const order = db.find('orders', { id: 'o1' }) as any;
    expect(order.status).toBe('delivered');
    expect(order.delivered_at).toBeTruthy();
    expect(order.auto_release_at ?? null).toBeNull();
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

// H2: shipListing capture must never run against a dead auth (fake-db so the
// projection/filter + branch mutants are actually killed).
describe('shipListing (escrow capture vs dead auth)', () => {
  it('captures the authorized PI and marks the listing shipped', async () => {
    const db = seedReserved();
    const r = await shipListing(ctxFor(db, 'seller-1'), { listingId: 'l1', trackingCode: 'TRK1' });
    expect(r.ok).toBe(true);
    expect(piRetrieve).toHaveBeenCalledWith('pi_hold');
    expect(piCapture).toHaveBeenCalledWith('pi_hold');
    expect(db.find('listings', { id: 'l1' })!.status).toBe('shipped'); // catalog projection
    // The order owns the ship detail (tracking, timestamps).
    const order = db.find('orders', { id: 'o1' }) as any;
    expect(order.status).toBe('shipped');
    expect(order.tracking_code).toBe('TRK1');
    expect(order.shipped_at).toBeTruthy();
  });

  it('skips capture when the PI already succeeded, still ships', async () => {
    piRetrieve.mockResolvedValueOnce({ status: 'succeeded' });
    const db = seedReserved();
    const r = await shipListing(ctxFor(db, 'seller-1'), { listingId: 'l1', trackingCode: 'TRK' });
    expect(r.ok).toBe(true);
    expect(piCapture).not.toHaveBeenCalled();
    expect((db.find('listings', { id: 'l1' }) as any).status).toBe('shipped');
  });

  it('releases the reservation (no ship, no capture) when the auth is dead', async () => {
    piRetrieve.mockResolvedValueOnce({ status: 'canceled' });
    const db = seedReserved();
    const r = await shipListing(ctxFor(db, 'seller-1'), { listingId: 'l1', trackingCode: 'TRK' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
    expect(piCapture).not.toHaveBeenCalled();
    const row = db.find('listings', { id: 'l1' }) as any;
    expect(row.status).toBe('active'); // relisted, not shipped
    expect(row.buyer_id).toBeNull();
    expect(recordDeadLetter).toHaveBeenCalledTimes(1);
    // Phase B shadow: order cancelled, reason auth_canceled (dead auth at ship).
    const order = db.find('orders', { id: 'o1' }) as any;
    expect(order.status).toBe('cancelled');
    expect(order.cancel_reason).toBe('auth_canceled');
  });

  it('skips the whole capture step while payouts are paused, still ships', async () => {
    const db = seedReserved();
    const ctx = ctxFor(db, 'seller-1');
    (ctx.env as any).KILL_PAYOUTS = 'on';
    const r = await shipListing(ctx, { listingId: 'l1', trackingCode: 'TRK' });
    expect(r.ok).toBe(true);
    expect(piRetrieve).not.toHaveBeenCalled(); // entire block guarded out
    expect(piCapture).not.toHaveBeenCalled();
    expect((db.find('listings', { id: 'l1' }) as any).status).toBe('shipped');
  });

  it('rejects shipping a listing that is not reserved', async () => {
    const db = seedReserved({ status: 'active' });
    const r = await shipListing(ctxFor(db, 'seller-1'), { listingId: 'l1', trackingCode: 'TRK' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('ships without any Stripe call when there is no payment intent (legacy/free)', async () => {
    const db = seedReserved({ stripe_payment_intent_id: null });
    const r = await shipListing(ctxFor(db, 'seller-1'), { listingId: 'l1', trackingCode: 'TRK' });
    expect(r.ok).toBe(true);
    expect(piRetrieve).not.toHaveBeenCalled();
    expect(piCapture).not.toHaveBeenCalled();
    expect((db.find('listings', { id: 'l1' }) as any).status).toBe('shipped');
  });

  it('not_found when the actor is not the seller', async () => {
    const db = seedReserved();
    const r = await shipListing(ctxFor(db, 'someone-else'), { listingId: 'l1', trackingCode: 'TRK' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });
});

// H2: ship-by-deadline / auth-expiry — release a never-shipped reservation
// before the 7-day manual-capture auth dies, instead of capturing for an item
// that never shipped.
describe('releaseExpiredReservation', () => {
  it('cancels the hold, relists, and notifies both parties', async () => {
    const db = seedReserved(); // retrieve → requires_capture (default)
    const r = await releaseExpiredReservation(db.client as any, RELEASE_ENV, { listingId: 'l1', reason: 'ship_deadline' });
    expect(r.released).toBe(true);

    // The uncaptured auth is canceled (buyer's hold returned).
    expect(piCancel).toHaveBeenCalledWith('pi_hold');

    // Catalog row is back to active + the holder cleared.
    const row = db.find('listings', { id: 'l1' }) as any;
    expect(row.status).toBe('active');
    expect(row.buyer_id).toBeNull();

    // The order keeps the cancelled record + history (PII/PI retained there).
    const order = db.find('orders', { id: 'o1' }) as any;
    expect(order.status).toBe('cancelled');
    expect(order.cancel_reason).toBe('ship_deadline');
    expect(order.cancelled_at).toBeTruthy();
    expect(order.stripe_payment_intent_id).toBe('pi_hold'); // history retained, not wiped

    // Both parties told; buyer learns they weren't charged.
    expect(createNotification).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(createNotification).mock.calls;
    const buyerNote = calls.find(c => (c[1] as any).userId === 'buyer-1')![1] as any;
    const sellerNote = calls.find(c => (c[1] as any).userId === 'seller-1')![1] as any;
    expect(buyerNote.type).toBe('listing_reservation_released');
    expect(buyerNote.body).toContain('ikke belastet');
    expect(sellerNote.type).toBe('listing_reservation_released');
    expect(sellerNote.body).toContain('innen fristen'); // ship_deadline copy
  });

  it('still relists when the auth already expired (canceled) — nothing to cancel', async () => {
    piRetrieve.mockResolvedValueOnce({ status: 'canceled' });
    const db = seedReserved();
    const r = await releaseExpiredReservation(db.client as any, RELEASE_ENV, { listingId: 'l1', reason: 'auth_canceled' });
    expect(r.released).toBe(true);
    expect(piCancel).not.toHaveBeenCalled(); // already canceled, no double-cancel
    expect((db.find('listings', { id: 'l1' }) as any).status).toBe('active');
    const sellerNote = vi.mocked(createNotification).mock.calls.find(c => (c[1] as any).userId === 'seller-1')![1] as any;
    expect(sellerNote.body).toContain('utløp'); // auth_canceled copy
  });

  it('relists a no-payment-intent reservation without any Stripe call', async () => {
    const db = seedReserved({ stripe_payment_intent_id: null });
    const r = await releaseExpiredReservation(db.client as any, RELEASE_ENV, { listingId: 'l1', reason: 'ship_deadline' });
    expect(r.released).toBe(true);
    expect(piRetrieve).not.toHaveBeenCalled();
    expect(piCancel).not.toHaveBeenCalled();
    expect((db.find('listings', { id: 'l1' }) as any).status).toBe('active');
  });

  it('is a no-op when the listing is no longer reserved (cron/webhook race)', async () => {
    const db = seedReserved({ status: 'shipped' });
    const r = await releaseExpiredReservation(db.client as any, RELEASE_ENV, { listingId: 'l1', reason: 'ship_deadline' });
    expect(r.released).toBe(false);
    expect(piCancel).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect((db.find('listings', { id: 'l1' }) as any).status).toBe('shipped'); // untouched
  });

  it('NEVER reverts a captured charge — dead-letters and leaves it reserved', async () => {
    piRetrieve.mockResolvedValueOnce({ status: 'succeeded' });
    const db = seedReserved();
    const r = await releaseExpiredReservation(db.client as any, RELEASE_ENV, { listingId: 'l1', reason: 'ship_deadline' });
    expect(r.released).toBe(false);
    expect(piCancel).not.toHaveBeenCalled();
    expect(recordDeadLetter).toHaveBeenCalledTimes(1);
    // Money was captured — do NOT silently relist (that would lose it).
    expect((db.find('listings', { id: 'l1' }) as any).status).toBe('reserved');
    expect(createNotification).not.toHaveBeenCalled();
  });

  // Every still-uncaptured auth state must be cancelable (releases the hold).
  it.each(['requires_capture', 'requires_payment_method', 'requires_confirmation', 'requires_action'])(
    'cancels the hold for an uncaptured PI in state %s',
    async (status) => {
      piRetrieve.mockResolvedValueOnce({ status });
      const db = seedReserved();
      const r = await releaseExpiredReservation(db.client as any, RELEASE_ENV, { listingId: 'l1', reason: 'ship_deadline' });
      expect(r.released).toBe(true);
      expect(piCancel).toHaveBeenCalledWith('pi_hold');
      expect((db.find('listings', { id: 'l1' }) as any).status).toBe('active');
    },
  );
});
