import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payCommission } from './commissions';
import { createNotification } from '../notify';
import { createFakeDb, type FakeDb } from './__test_helpers__/fake-db';
import type { ServiceContext } from './types';

// Projection on: reads return only selected columns, so a dropped/blanked
// `.select(...)` surfaces as a missing field (kills column-list mutants).
const fakeDb = (seed: Record<string, Record<string, unknown>[]>) =>
  createFakeDb(seed, { projectColumns: true });

// R2-15+ — money-math + side-effect coverage for commission payment,
// backed by the in-memory fake (fake-db.ts).

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

function ctxFor(db: FakeDb, userId = 'buyer-1'): ServiceContext {
  return {
    supabase: db.client as any,
    admin: db.client as any,
    user: { id: userId, email: 'buyer@x.io' },
    env: { STRIPE_SECRET_KEY: 'sk_test', PUBLIC_SITE_URL: 'https://test.site' } as any,
  };
}

interface SeedOpts { req?: Record<string, unknown>; offer?: Record<string, unknown>; role?: string; connect?: Record<string, unknown>; }

function seed(o: SeedOpts = {}): FakeDb {
  return fakeDb({
    commission_requests: [{
      id: 'req-1', buyer_id: 'buyer-1', status: 'awaiting_payment',
      awarded_offer_id: 'offer-1', title: 'Strikket teppe', category: 'teppe',
      size_label: 'M', colorway: 'blue', yarn_preference: null,
      pattern_external_title: null, yarn_provided_by_buyer: false,
      ...o.req,
    }],
    // project_id set so ensureCommissionProject takes the idempotent update path.
    commission_offers: [{ id: 'offer-1', knitter_id: 'knitter-1', price_nok: 1000, project_id: 'proj-1', ...o.offer }],
    profiles: [{ id: 'knitter-1', role: o.role ?? 'user' }],
    seller_profiles: [{ id: 'knitter-1', stripe_account_id: 'acct_knitter', stripe_connect_status: 'verified', ...o.connect }],
    projects: [{ id: 'proj-1', status: 'planning', started_at: null }],
  });
}

describe('payCommission — money math', () => {
  it('non-ambassador knitter pays 13% commission (real row state)', async () => {
    const db = seed();
    const r = await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(r.ok).toBe(true);

    expect(piCreate).toHaveBeenCalledTimes(1);
    const args = piCreate.mock.calls[0][0] as any;
    expect(args.amount).toBe(100000);          // 1000 kr -> ore
    expect(args.application_fee_amount).toBe(13000); // 13%
    expect(args.currency).toBe('nok');
    expect(args.capture_method).toBe('manual');
    expect(args.transfer_data.destination).toBe('acct_knitter');

    const row = db.find('commission_requests', { id: 'req-1' }) as any;
    expect(row.status).toBe('awarded');
    expect(row.stripe_payment_intent_id).toBe('pi_new');
    expect(row.platform_fee_nok).toBe(130); // 13000 ore -> kr
  });

  it('ambassador knitter pays 8% commission', async () => {
    const db = seed({ role: 'ambassador' });
    await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect((piCreate.mock.calls[0][0] as any).application_fee_amount).toBe(8000);
    expect((db.find('commission_requests', { id: 'req-1' }) as any).platform_fee_nok).toBe(80);
  });

  it('confirms the created PaymentIntent with the right method + return URL', async () => {
    const db = seed({ req: { buyer_id: 'buyer-7' } });
    await payCommission(ctxFor(db, 'buyer-7'), { requestId: 'req-1' });
    expect(piConfirm).toHaveBeenCalledTimes(1);
    expect(piConfirm.mock.calls[0][0]).toBe('pi_new');
    expect(piConfirm.mock.calls[0][1]).toMatchObject({
      payment_method: 'pm_card_visa',
      return_url: 'https://test.site/market/commissions/req-1',
    });
    expect((piCreate.mock.calls[0][0] as any).metadata).toMatchObject({
      commission_request_id: 'req-1', buyer_id: 'buyer-7',
    });
  });

  // Fee conservation + price sweep: the PI amount is the full price, the fee
  // is the platform's cut, and platform_fee_nok is that cut rounded to kroner.
  it.each([
    [1, 13], [50, 13], [199, 13], [200, 8], [999, 13], [1000, 8], [4999, 13], [5000, 8],
  ])('price %d kr @ %d%% — amount, fee and stored fee all reconcile', async (price, pct) => {
    const db = seed({ offer: { price_nok: price }, role: pct === 8 ? 'ambassador' : 'user' });
    await payCommission(ctxFor(db), { requestId: 'req-1' });
    const args = piCreate.mock.calls[0][0] as any;

    const amountOre = price * 100;
    const expectedFee = Math.round(amountOre * pct / 100);
    expect(args.amount).toBe(amountOre);
    expect(args.application_fee_amount).toBe(expectedFee);
    expect(expectedFee).toBeLessThanOrEqual(amountOre); // platform never takes more than the price
    expect((db.find('commission_requests', { id: 'req-1' }) as any).platform_fee_nok)
      .toBe(Math.round(expectedFee / 100));
  });
});

describe('payCommission — yarn + Stripe-less paths', () => {
  it('routes to awaiting_yarn when buyer provides yarn', async () => {
    const db = seed({ req: { yarn_provided_by_buyer: true } });
    const r = await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(r.ok).toBe(true);
    expect((db.find('commission_requests', { id: 'req-1' }) as any).status).toBe('awaiting_yarn');
  });

  it('skips Stripe when knitter is not verified, fee still recorded', async () => {
    const db = seed({ connect: { stripe_account_id: null, stripe_connect_status: 'pending' } });
    const r = await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(r.ok).toBe(true);
    expect(piCreate).not.toHaveBeenCalled();
    expect(piConfirm).not.toHaveBeenCalled();
    const row = db.find('commission_requests', { id: 'req-1' }) as any;
    expect(row.status).toBe('awarded');
    expect(row.stripe_payment_intent_id).toBeNull();
    expect(row.platform_fee_nok).toBe(130);
  });

  it('skips Stripe when knitter is verified but has no payout account id', async () => {
    const db = seed({ connect: { stripe_account_id: null, stripe_connect_status: 'verified' } });
    const r = await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(r.ok).toBe(true);
    expect(piCreate).not.toHaveBeenCalled();
    expect((db.find('commission_requests', { id: 'req-1' }) as any).stripe_payment_intent_id).toBeNull();
  });

  it('skips Stripe when the knitter has no payout-connect row at all', async () => {
    const db = fakeDb({
      commission_requests: [{ id: 'req-1', buyer_id: 'buyer-1', status: 'awaiting_payment', awarded_offer_id: 'offer-1', title: 'T', yarn_provided_by_buyer: false }],
      commission_offers: [{ id: 'offer-1', knitter_id: 'knitter-1', price_nok: 1000, project_id: 'proj-1' }],
      profiles: [{ id: 'knitter-1', role: 'user' }],
      // No seller_profiles row -> knitterSeller is null.
      projects: [{ id: 'proj-1', status: 'planning', started_at: null }],
    });
    const r = await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(r.ok).toBe(true);
    expect(piCreate).not.toHaveBeenCalled();
  });

  it('defaults to the standard 13% fee when the knitter profile row is missing', async () => {
    const db = fakeDb({
      commission_requests: [{ id: 'req-1', buyer_id: 'buyer-1', status: 'awaiting_payment', awarded_offer_id: 'offer-1', title: 'T', yarn_provided_by_buyer: false }],
      commission_offers: [{ id: 'offer-1', knitter_id: 'knitter-1', price_nok: 1000, project_id: 'proj-1' }],
      // No profiles row -> knitterProfile null -> not ambassador -> 13%.
      seller_profiles: [{ id: 'knitter-1', stripe_account_id: 'acct_knitter', stripe_connect_status: 'verified' }],
      projects: [{ id: 'proj-1', status: 'planning', started_at: null }],
    });
    await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect((piCreate.mock.calls[0][0] as any).application_fee_amount).toBe(13000);
  });

  it('returns the redirect to the commission page', async () => {
    const db = seed();
    const r = await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toBe('/market/commissions/req-1');
  });

  it('activates the linked project once payment commits', async () => {
    const db = seed();
    await payCommission(ctxFor(db), { requestId: 'req-1' });
    const project = db.find('projects', { id: 'proj-1' }) as any;
    expect(project.status).toBe('active');
    expect(typeof project.started_at).toBe('string');
  });
});

describe('payCommission — guards + notification', () => {
  it('rejects empty request id', async () => {
    const db = seed();
    const r = await payCommission(ctxFor(db), { requestId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('bad_input'); expect(r.message).toBeTruthy(); }
  });

  it('forbids paying someone else’s request', async () => {
    const db = seed();
    const r = await payCommission(ctxFor(db, 'not-the-buyer'), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('forbidden'); expect(r.message).toBeTruthy(); }
    expect(piCreate).not.toHaveBeenCalled();
  });

  it('rejects a request not in awaiting_payment', async () => {
    const db = seed({ req: { status: 'open' } });
    const r = await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('bad_input'); expect(r.message).toBeTruthy(); }
  });

  it('not_found when the awarded offer is missing', async () => {
    // awarded_offer_id points at offer-1 but the only offer row has a different id.
    const db = seed({ offer: { id: 'a-different-offer' } });
    const r = await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('not_found'); expect(r.message).toBeTruthy(); }
    expect(piCreate).not.toHaveBeenCalled();
  });

  it('notifies the knitter that payment was received (start-knitting body)', async () => {
    const db = seed();
    await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(createNotification).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(createNotification).mock.calls[0];
    expect(payload).toMatchObject({
      userId: 'knitter-1', type: 'payment_received', title: 'Betaling mottatt!',
      url: '/market/commissions/req-1', referenceId: 'req-1', actorId: 'buyer-1',
    });
    expect((payload as any).body).toContain('Strikket teppe');
    expect((payload as any).body).toContain('begynne å strikke');
  });

  it('notifies with the awaiting-yarn body when buyer provides yarn', async () => {
    const db = seed({ req: { yarn_provided_by_buyer: true } });
    await payCommission(ctxFor(db), { requestId: 'req-1' });
    const [, payload] = vi.mocked(createNotification).mock.calls[0];
    expect((payload as any).body).toContain('Venter på at kjøper sender garnet');
  });
});
