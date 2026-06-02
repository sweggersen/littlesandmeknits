import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payCommission } from './commissions';
import { createNotification } from '../notify';
import { createMockSupabase, type MockSupabase } from './__test_helpers__/mock-supabase';
import type { ServiceContext } from './types';

// R2-15 — money-math + side-effect coverage for commission payment.

vi.mock('../notify', () => ({ createNotification: vi.fn() }));
vi.mock('./dead-letter', () => ({ recordDeadLetter: vi.fn() }));

const piCreate = vi.fn(async (_args?: any) => ({ id: 'pi_new' }));
const piConfirm = vi.fn(async (_id?: any, _opts?: any) => ({}));
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({
    paymentIntents: { create: piCreate, confirm: piConfirm },
  })),
}));

beforeEach(() => {
  piCreate.mockClear();
  piConfirm.mockClear();
  vi.mocked(createNotification).mockClear();
});

function ctxFor(mock: MockSupabase, userId = 'buyer-1'): ServiceContext {
  return {
    supabase: mock.client as any,
    admin: mock.client as any,
    user: { id: userId, email: 'buyer@x.io' },
    env: { STRIPE_SECRET_KEY: 'sk_test', PUBLIC_SITE_URL: 'https://test.site' } as any,
  };
}

const baseReq = {
  id: 'req-1', buyer_id: 'buyer-1', status: 'awaiting_payment',
  awarded_offer_id: 'offer-1', title: 'Strikket teppe', category: 'teppe',
  size_label: 'M', colorway: 'blue', yarn_preference: null,
  pattern_external_title: null, yarn_provided_by_buyer: false,
};
// project_id set so ensureCommissionProject takes the idempotent update path.
const baseOffer = { id: 'offer-1', knitter_id: 'knitter-1', price_nok: 1000, project_id: 'proj-1' };

function fixturesFor(overrides: { req?: any; offer?: any; role?: string; connect?: any } = {}) {
  return {
    read: {
      commission_requests: { ...baseReq, ...overrides.req },
      commission_offers: { ...baseOffer, ...overrides.offer },
      profiles: { role: overrides.role ?? 'user' },
      seller_profiles: overrides.connect ?? { stripe_account_id: 'acct_knitter', stripe_connect_status: 'verified' },
    },
  };
}

describe('payCommission — money math', () => {
  it('non-ambassador knitter pays 13% commission', async () => {
    const mock = createMockSupabase(fixturesFor());
    const r = await payCommission(ctxFor(mock), { requestId: 'req-1' });
    expect(r.ok).toBe(true);

    expect(piCreate).toHaveBeenCalledTimes(1);
    const args = piCreate.mock.calls[0][0] as any;
    // 1000 -> 100000 ore; 13% = 13000.
    expect(args.amount).toBe(100000);
    expect(args.application_fee_amount).toBe(13000);
    expect(args.currency).toBe('nok');
    expect(args.capture_method).toBe('manual');
    expect(args.transfer_data.destination).toBe('acct_knitter');

    // platform_fee_nok stored back in kroner (13000 ore / 100 = 130).
    const upd = mock.updates('commission_requests');
    expect(upd).toHaveLength(1);
    expect(upd[0].payload).toMatchObject({
      status: 'awarded',
      stripe_payment_intent_id: 'pi_new',
      platform_fee_nok: 130,
    });
  });

  it('ambassador knitter pays 8% commission', async () => {
    const mock = createMockSupabase(fixturesFor({ role: 'ambassador' }));
    const r = await payCommission(ctxFor(mock), { requestId: 'req-1' });
    expect(r.ok).toBe(true);
    const args = piCreate.mock.calls[0][0] as any;
    // 8% of 100000 = 8000.
    expect(args.application_fee_amount).toBe(8000);
    expect(mock.updates('commission_requests')[0].payload).toMatchObject({ platform_fee_nok: 80 });
  });

  it('rounds odd amounts correctly (price 999 @ 13%)', async () => {
    const mock = createMockSupabase(fixturesFor({ offer: { price_nok: 999 } }));
    await payCommission(ctxFor(mock), { requestId: 'req-1' });
    const args = piCreate.mock.calls[0][0] as any;
    // 99900 * 0.13 = 12987 exactly.
    expect(args.amount).toBe(99900);
    expect(args.application_fee_amount).toBe(12987);
    // 12987 / 100 -> round -> 130.
    expect(mock.updates('commission_requests')[0].payload).toMatchObject({ platform_fee_nok: 130 });
  });

  it('confirms the created PaymentIntent', async () => {
    const mock = createMockSupabase(fixturesFor());
    await payCommission(ctxFor(mock), { requestId: 'req-1' });
    expect(piConfirm).toHaveBeenCalledTimes(1);
    expect(piConfirm.mock.calls[0][0]).toBe('pi_new');
  });

  it('stamps the PI metadata with request + buyer', async () => {
    const mock = createMockSupabase(fixturesFor({ req: { buyer_id: 'buyer-7' } }));
    await payCommission(ctxFor(mock, 'buyer-7'), { requestId: 'req-1' });
    const args = piCreate.mock.calls[0][0] as any;
    expect(args.metadata).toMatchObject({ commission_request_id: 'req-1', buyer_id: 'buyer-7' });
  });
});

describe('payCommission — yarn + Stripe-less paths', () => {
  it('routes to awaiting_yarn when buyer provides yarn', async () => {
    const mock = createMockSupabase(fixturesFor({ req: { yarn_provided_by_buyer: true } }));
    const r = await payCommission(ctxFor(mock), { requestId: 'req-1' });
    expect(r.ok).toBe(true);
    expect(mock.updates('commission_requests')[0].payload).toMatchObject({ status: 'awaiting_yarn' });
  });

  it('skips Stripe entirely when knitter is not verified, fee still recorded', async () => {
    const mock = createMockSupabase(fixturesFor({
      connect: { stripe_account_id: null, stripe_connect_status: 'pending' },
    }));
    const r = await payCommission(ctxFor(mock), { requestId: 'req-1' });
    expect(r.ok).toBe(true);
    expect(piCreate).not.toHaveBeenCalled();
    expect(piConfirm).not.toHaveBeenCalled();
    expect(mock.updates('commission_requests')[0].payload).toMatchObject({
      status: 'awarded',
      stripe_payment_intent_id: null,
      platform_fee_nok: 130, // still computed from the offer price
    });
  });
});

describe('payCommission — guards + notification', () => {
  it('rejects empty request id', async () => {
    const mock = createMockSupabase({});
    const r = await payCommission(ctxFor(mock), { requestId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('forbids paying someone else’s request', async () => {
    const mock = createMockSupabase(fixturesFor());
    const r = await payCommission(ctxFor(mock, 'not-the-buyer'), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
    expect(piCreate).not.toHaveBeenCalled();
  });

  it('rejects a request not in awaiting_payment', async () => {
    const mock = createMockSupabase(fixturesFor({ req: { status: 'open' } }));
    const r = await payCommission(ctxFor(mock), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('notifies the knitter that payment was received', async () => {
    const mock = createMockSupabase(fixturesFor());
    await payCommission(ctxFor(mock), { requestId: 'req-1' });
    expect(createNotification).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(createNotification).mock.calls[0];
    expect(payload).toMatchObject({
      userId: 'knitter-1',
      type: 'payment_received',
      title: 'Betaling mottatt!',
      url: '/market/commissions/req-1',
      referenceId: 'req-1',
    });
  });
});
