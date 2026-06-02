import { describe, it, expect, vi, beforeEach } from 'vitest';
import { purchaseListing, confirmListingDelivery } from './listings';
import { createNotification } from '../notify';
import { createMockSupabase, type MockSupabase } from './__test_helpers__/mock-supabase';
import type { ServiceContext } from './types';

// R2-15 — rigorous money-math + side-effect coverage for the listing buy
// flow. Unlike the older loose mockCtx, createMockSupabase records exact
// filters and payloads, so these tests assert the real numbers Stripe is
// told to charge, not just "a checkout happened".

vi.mock('../notify', () => ({
  createNotification: vi.fn(),
  notifyModeratorsNewItem: vi.fn(),
  notifyFollowersOfNewListing: vi.fn(),
}));
vi.mock('./dead-letter', () => ({ recordDeadLetter: vi.fn() }));

const checkoutCreate = vi.fn(async (_args?: any) => ({ url: 'https://checkout.stripe.com/c/test_123' }));
const piCapture = vi.fn(async () => ({}));
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({
    checkout: { sessions: { create: checkoutCreate } },
    paymentIntents: { capture: piCapture },
  })),
}));

beforeEach(() => {
  checkoutCreate.mockClear();
  piCapture.mockClear();
  vi.mocked(createNotification).mockClear();
});

function ctxFor(mock: MockSupabase, userId = 'buyer-1', email = 'buyer@x.io'): ServiceContext {
  return {
    supabase: mock.client as any,
    admin: mock.client as any,
    user: { id: userId, email },
    env: { STRIPE_SECRET_KEY: 'sk_test', PUBLIC_SITE_URL: 'https://test.site' } as any,
  };
}

/** The args the service passed to Stripe Checkout, for money assertions. */
function checkoutArgs(): any {
  expect(checkoutCreate).toHaveBeenCalledTimes(1);
  return checkoutCreate.mock.calls[0][0];
}

const baseListing = {
  id: 'l1', seller_id: 'seller-1', store_id: null,
  title: 'Babygenser', price_nok: 500, status: 'active',
  hero_photo_path: null, escrow_enabled: true,
  shipping_option: 'small_parcel', shipping_price_nok: 76,
};

describe('purchaseListing — personal seller money math', () => {
  it('charges item + shipping + TB fee, application fee = 13% of item + TB fee', async () => {
    const mock = createMockSupabase({
      read: {
        listings: baseListing,
        profiles: { role: 'user' },
        seller_profiles: { stripe_account_id: 'acct_seller', stripe_connect_status: 'verified' },
      },
    });
    const r = await purchaseListing(ctxFor(mock), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(true);

    const args = checkoutArgs();
    // price 500 -> 50000 ore; shipping 76 -> 7600; TB fee for 500 = 19 -> 1900.
    const amounts = args.line_items.map((li: any) => li.price_data.unit_amount);
    expect(amounts).toEqual([50000, 7600, 1900]);
    // application_fee = 13% of 50000 (=6500) + TB fee 1900 = 8400.
    expect(args.payment_intent_data.application_fee_amount).toBe(8400);
    expect(args.payment_intent_data.transfer_data.destination).toBe('acct_seller');
    expect(args.payment_intent_data.capture_method).toBe('manual');
  });

  it('ambassador seller pays 8% commission, free shipping omits the shipping line', async () => {
    const mock = createMockSupabase({
      read: {
        listings: { ...baseListing, price_nok: 1000, shipping_option: 'free', shipping_price_nok: 0 },
        profiles: { role: 'ambassador' },
        seller_profiles: { stripe_account_id: 'acct_amb', stripe_connect_status: 'verified' },
      },
    });
    const r = await purchaseListing(ctxFor(mock), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(true);

    const args = checkoutArgs();
    // 1000 -> 100000 ore item; TB fee for 1000 = 29 -> 2900; no shipping line.
    const amounts = args.line_items.map((li: any) => li.price_data.unit_amount);
    expect(amounts).toEqual([100000, 2900]);
    // 8% of 100000 = 8000, + TB 2900 = 10900.
    expect(args.payment_intent_data.application_fee_amount).toBe(10900);
  });

  it('stamps metadata with buyer, seller, TB and shipping amounts', async () => {
    const mock = createMockSupabase({
      read: {
        listings: baseListing,
        profiles: { role: 'user' },
        seller_profiles: { stripe_account_id: 'acct_seller', stripe_connect_status: 'verified' },
      },
    });
    await purchaseListing(ctxFor(mock, 'buyer-9'), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    const args = checkoutArgs();
    expect(args.metadata).toMatchObject({
      type: 'listing_purchase',
      listing_id: 'l1',
      buyer_id: 'buyer-9',
      seller_id: 'seller-1',
      tb_fee_nok: '19',
      shipping_nok: '76',
      store_id: '',
    });
    expect(args.client_reference_id).toBe('buyer-9');
  });
});

describe('purchaseListing — store-owned tier fees', () => {
  const storeListing = { ...baseListing, store_id: 'store-1', price_nok: 600, shipping_option: 'free', shipping_price_nok: 0 };

  it.each([
    ['starter', 15], // 13 + 2
    ['pro', 14],     // 13 + 1
    ['elite', 13],   // 13 + 0
    [undefined, 15], // unknown tier -> +2 default
  ])('tier=%s applies %d%% commission', async (tier, pct) => {
    const mock = createMockSupabase({
      read: {
        listings: storeListing,
        stores: { stripe_account_id: 'acct_store', stripe_onboarded: true, tier, status: 'active' },
      },
    });
    const r = await purchaseListing(ctxFor(mock), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(true);
    const args = checkoutArgs();
    // item 600 -> 60000 ore; fee = pct% of 60000; TB for 600 = 29 -> 2900.
    const expectedFee = Math.round(60000 * pct / 100) + 2900;
    expect(args.payment_intent_data.application_fee_amount).toBe(expectedFee);
    expect(args.payment_intent_data.transfer_data.destination).toBe('acct_store');
  });
});

describe('purchaseListing — guards', () => {
  const okSeller = {
    profiles: { role: 'user' },
    seller_profiles: { stripe_account_id: 'acct', stripe_connect_status: 'verified' },
  };

  it('rejects empty listing id', async () => {
    const mock = createMockSupabase({});
    const r = await purchaseListing(ctxFor(mock), { listingId: '', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('not_found when listing missing', async () => {
    const mock = createMockSupabase({ read: { listings: null } });
    const r = await purchaseListing(ctxFor(mock), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('conflict when listing not active', async () => {
    const mock = createMockSupabase({ read: { listings: { ...baseListing, status: 'sold' }, ...okSeller } });
    const r = await purchaseListing(ctxFor(mock), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('rejects buying your own listing', async () => {
    const mock = createMockSupabase({ read: { listings: baseListing, ...okSeller } });
    const r = await purchaseListing(ctxFor(mock, 'seller-1'), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('conflict when escrow not enabled', async () => {
    const mock = createMockSupabase({ read: { listings: { ...baseListing, escrow_enabled: false }, ...okSeller } });
    const r = await purchaseListing(ctxFor(mock), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('conflict when seller not onboarded to Stripe', async () => {
    const mock = createMockSupabase({
      read: {
        listings: baseListing,
        profiles: { role: 'user' },
        seller_profiles: { stripe_account_id: null, stripe_connect_status: 'pending' },
      },
    });
    const r = await purchaseListing(ctxFor(mock), { listingId: 'l1', stripeSecretKey: 'sk_test' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
    expect(checkoutCreate).not.toHaveBeenCalled();
  });
});

describe('confirmListingDelivery', () => {
  const reservedListing = {
    id: 'l1', seller_id: 'seller-1', buyer_id: 'buyer-1',
    title: 'Babygenser', status: 'shipped', stripe_payment_intent_id: 'pi_abc',
  };

  it('captures the same PI the buy created, marks sold + delivered', async () => {
    const mock = createMockSupabase({ read: { listings: reservedListing } });
    const r = await confirmListingDelivery(ctxFor(mock, 'buyer-1'), { listingId: 'l1' });
    expect(r.ok).toBe(true);
    expect(piCapture).toHaveBeenCalledWith('pi_abc');

    const upd = mock.updates('listings');
    expect(upd).toHaveLength(1);
    expect(upd[0].payload).toMatchObject({ status: 'sold', auto_release_at: null });
    expect((upd[0].payload as any).sold_at).toBe((upd[0].payload as any).delivered_at);
    // Updated the right row.
    expect(upd[0].filters).toContainEqual({ type: 'eq', col: 'id', val: 'l1' });
  });

  it('notifies the seller with the delivery-confirmed message', async () => {
    const mock = createMockSupabase({ read: { listings: reservedListing } });
    await confirmListingDelivery(ctxFor(mock, 'buyer-1'), { listingId: 'l1' });
    expect(createNotification).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(createNotification).mock.calls[0];
    expect(payload).toMatchObject({
      userId: 'seller-1',
      type: 'listing_delivered',
      title: 'Levering bekreftet!',
      url: '/market/listing/l1',
      actorId: 'buyer-1',
      referenceId: 'l1',
    });
  });

  it('forbids a non-buyer confirming delivery', async () => {
    const mock = createMockSupabase({ read: { listings: reservedListing } });
    const r = await confirmListingDelivery(ctxFor(mock, 'someone-else'), { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
    expect(piCapture).not.toHaveBeenCalled();
    expect(mock.updates('listings')).toHaveLength(0);
  });

  it('rejects confirming in a non-shipped/reserved state', async () => {
    const mock = createMockSupabase({ read: { listings: { ...reservedListing, status: 'sold' } } });
    const r = await confirmListingDelivery(ctxFor(mock, 'buyer-1'), { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('skips capture when there is no payment intent (free/legacy)', async () => {
    const mock = createMockSupabase({ read: { listings: { ...reservedListing, stripe_payment_intent_id: null } } });
    const r = await confirmListingDelivery(ctxFor(mock, 'buyer-1'), { listingId: 'l1' });
    expect(r.ok).toBe(true);
    expect(piCapture).not.toHaveBeenCalled();
    expect(mock.updates('listings')).toHaveLength(1);
  });
});
