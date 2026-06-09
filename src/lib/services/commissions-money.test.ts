import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payCommission, finalizeCommissionPayment } from './commissions';
import { createNotification } from '../notify';
import { createFakeDb, type FakeDb } from './__test_helpers__/fake-db';
import type { ServiceContext } from './types';

// Projection on: reads return only selected columns, so a dropped/blanked
// `.select(...)` surfaces as a missing field (kills column-list mutants).
const fakeDb = (seed: Record<string, Record<string, unknown>[]>) =>
  createFakeDb(seed, { projectColumns: true });

// Money-math + side-effect coverage for commission payment. payCommission now
// builds a real hosted Checkout Session (the buyer actually pays); the
// post-payment side-effects live in finalizeCommissionPayment, run by the
// webhook once Stripe confirms.

vi.mock('../notify', () => ({ createNotification: vi.fn() }));
vi.mock('./dead-letter', () => ({ recordDeadLetter: vi.fn() }));

const sessionCreate = vi.fn(async (_args?: any) => ({ url: 'https://checkout.stripe.com/c/sess_1' }));
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({
    checkout: { sessions: { create: sessionCreate } },
  })),
}));

beforeEach(() => {
  sessionCreate.mockClear();
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
      awarded_offer_id: 'offer-1', title: 'Strikket teppe', description: null,
      size_label: 'M', colorway: 'blue', yarn_preference: null,
      pattern_external_title: null, yarn_provided_by_buyer: false,
      stripe_payment_intent_id: null, platform_fee_nok: null,
      ...o.req,
    }],
    commission_offers: [{ id: 'offer-1', knitter_id: 'knitter-1', price_nok: 1000, project_id: 'proj-1', ...o.offer }],
    profiles: [{ id: 'knitter-1', role: o.role ?? 'user' }],
    seller_profiles: [{ id: 'knitter-1', stripe_account_id: 'acct_knitter', stripe_connect_status: 'verified', ...o.connect }],
    projects: [{ id: 'proj-1', status: 'planning', started_at: null }],
  });
}

describe('payCommission — builds a real Checkout Session', () => {
  it('non-ambassador knitter: 13% fee on a manual-capture destination charge', async () => {
    const db = seed();
    const r = await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toBe('https://checkout.stripe.com/c/sess_1');

    expect(sessionCreate).toHaveBeenCalledTimes(1);
    const args = sessionCreate.mock.calls[0][0] as any;
    expect(args.mode).toBe('payment');
    expect(args.line_items[0].price_data.unit_amount).toBe(100000); // 1000 kr -> ore
    expect(args.payment_intent_data.capture_method).toBe('manual');
    expect(args.payment_intent_data.application_fee_amount).toBe(13000); // 13%
    expect(args.payment_intent_data.transfer_data.destination).toBe('acct_knitter');
    expect(args.line_items[0].price_data.currency).toBe('nok');
    expect(args.line_items[0].price_data.product_data.name).toContain('Strikket teppe');
    expect(args.payment_method_types).toEqual(expect.arrayContaining(['vipps', 'card']));
    expect(args.success_url).toBe('https://test.site/market/commissions/req-1?paid=1');
    expect(args.cancel_url).toBe('https://test.site/market/commissions/req-1');
    expect(args.customer_email).toBe('buyer@x.io'); // prefilled so Vipps/card receipt reaches the buyer
    expect(args.locale).toBe('nb');
    expect(args.metadata).toMatchObject({ type: 'commission_payment', commission_request_id: 'req-1', buyer_id: 'buyer-1', platform_fee_ore: '13000' });

    // No side effects here — the request stays awaiting_payment until the webhook.
    const row = db.find('commission_requests', { id: 'req-1' }) as any;
    expect(row.status).toBe('awaiting_payment');
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('ambassador knitter pays 8%', async () => {
    const db = seed({ role: 'ambassador' });
    await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect((sessionCreate.mock.calls[0][0] as any).payment_intent_data.application_fee_amount).toBe(8000);
    expect((sessionCreate.mock.calls[0][0] as any).metadata.platform_fee_ore).toBe('8000');
  });

  // Price sweep: the fee is the platform's cut and is echoed in metadata so the
  // webhook stores exactly what was charged.
  it.each([
    [1, 13], [50, 13], [199, 13], [200, 8], [999, 13], [1000, 8], [4999, 13], [5000, 8],
  ])('price %d kr @ %d%% — fee reconciles', async (price, pct) => {
    const db = seed({ offer: { price_nok: price }, role: pct === 8 ? 'ambassador' : 'user' });
    await payCommission(ctxFor(db), { requestId: 'req-1' });
    const args = sessionCreate.mock.calls[0][0] as any;
    const amountOre = price * 100;
    const expectedFee = Math.round(amountOre * pct / 100);
    expect(args.line_items[0].price_data.unit_amount).toBe(amountOre);
    expect(args.payment_intent_data.application_fee_amount).toBe(expectedFee);
    expect(expectedFee).toBeLessThanOrEqual(amountOre); // platform never takes more than the price
    expect(args.metadata.platform_fee_ore).toBe(String(expectedFee));
  });
});

describe('payCommission — guards', () => {
  it('rejects empty request id', async () => {
    const r = await payCommission(ctxFor(seed()), { requestId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('forbids paying someone else’s request', async () => {
    const r = await payCommission(ctxFor(seed(), 'not-the-buyer'), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('rejects a request not in awaiting_payment', async () => {
    const r = await payCommission(ctxFor(seed({ req: { status: 'open' } })), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('not_found when the awarded offer is missing', async () => {
    const r = await payCommission(ctxFor(seed({ offer: { id: 'a-different-offer' } })), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('refuses to collect money for a knitter without verified payouts', async () => {
    const r = await payCommission(ctxFor(seed({ connect: { stripe_account_id: null, stripe_connect_status: 'pending' } })), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('refuses when verified but missing the payout account id', async () => {
    const r = await payCommission(ctxFor(seed({ connect: { stripe_account_id: null, stripe_connect_status: 'verified' } })), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('refuses when the knitter has no payout-connect row at all', async () => {
    const db = fakeDb({
      commission_requests: [{ id: 'req-1', buyer_id: 'buyer-1', status: 'awaiting_payment', awarded_offer_id: 'offer-1', title: 'T', yarn_provided_by_buyer: false }],
      commission_offers: [{ id: 'offer-1', knitter_id: 'knitter-1', price_nok: 1000 }],
      profiles: [{ id: 'knitter-1', role: 'user' }],
      // No seller_profiles row → knitterSeller is null.
    });
    const r = await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('defaults to the standard 13% fee when the knitter profile row is missing', async () => {
    const db = fakeDb({
      commission_requests: [{ id: 'req-1', buyer_id: 'buyer-1', status: 'awaiting_payment', awarded_offer_id: 'offer-1', title: 'T', yarn_provided_by_buyer: false }],
      commission_offers: [{ id: 'offer-1', knitter_id: 'knitter-1', price_nok: 1000 }],
      // No profiles row → knitterProfile null → not ambassador → 13%.
      seller_profiles: [{ id: 'knitter-1', stripe_account_id: 'acct_knitter', stripe_connect_status: 'verified' }],
    });
    await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect((sessionCreate.mock.calls[0][0] as any).payment_intent_data.application_fee_amount).toBe(13000);
  });

  it('is blocked by the commissions kill-switch (no checkout created)', async () => {
    const ctx = ctxFor(seed());
    (ctx.env as any).KILL_COMMISSIONS = 'on';
    const r = await payCommission(ctx, { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('service_unavailable');
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  // payCommission charges through the purchase rail, so the purchases kill-switch
  // must also stop it (killGuard(['purchases','commissions'])).
  it('is blocked by the purchases kill-switch too (no checkout created)', async () => {
    const ctx = ctxFor(seed());
    (ctx.env as any).KILL_PURCHASES = 'on';
    const r = await payCommission(ctx, { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('service_unavailable');
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('surfaces a server_error if Stripe returns a session without a URL', async () => {
    sessionCreate.mockResolvedValueOnce({ url: null } as any);
    const r = await payCommission(ctxFor(seed()), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('server_error');
  });
});

describe('finalizeCommissionPayment — post-payment (webhook)', () => {
  it('awards, records the PI + fee, activates the project, notifies the knitter', async () => {
    const db = seed();
    const r = await finalizeCommissionPayment(db.client as any, {} as any, { requestId: 'req-1', paymentIntentId: 'pi_real', platformFeeOre: 13000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.updated).toBe(true);

    const row = db.find('commission_requests', { id: 'req-1' }) as any;
    expect(row.status).toBe('awarded');
    expect(row.stripe_payment_intent_id).toBe('pi_real');
    expect(row.platform_fee_nok).toBe(130); // 13000 ore -> kr

    expect((db.find('projects', { id: 'proj-1' }) as any).status).toBe('active');

    expect(createNotification).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(createNotification).mock.calls[0];
    expect(payload).toMatchObject({ userId: 'knitter-1', type: 'payment_received', url: '/market/commissions/req-1' });
    expect((payload as any).body).toContain('begynne å strikke');
  });

  it('routes to awaiting_yarn (and that notification body) when buyer provides yarn', async () => {
    const db = seed({ req: { yarn_provided_by_buyer: true } });
    await finalizeCommissionPayment(db.client as any, {} as any, { requestId: 'req-1', paymentIntentId: 'pi_real', platformFeeOre: 13000 });
    expect((db.find('commission_requests', { id: 'req-1' }) as any).status).toBe('awaiting_yarn');
    const [, payload] = vi.mocked(createNotification).mock.calls[0];
    expect((payload as any).body).toContain('Venter på at kjøper sender garnet');
  });

  it('is idempotent: a retry after finalize is a no-op (no double notify)', async () => {
    const db = seed({ req: { status: 'awarded' } });
    const r = await finalizeCommissionPayment(db.client as any, {} as any, { requestId: 'req-1', paymentIntentId: 'pi_real', platformFeeOre: 13000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.updated).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('stores null fee when none was passed', async () => {
    const db = seed();
    await finalizeCommissionPayment(db.client as any, {} as any, { requestId: 'req-1', paymentIntentId: 'pi_real', platformFeeOre: null });
    expect((db.find('commission_requests', { id: 'req-1' }) as any).platform_fee_nok).toBeNull();
  });

  it('not_found when the request row is gone (no notify, no project touch)', async () => {
    const db = seed();
    const r = await finalizeCommissionPayment(db.client as any, {} as any, { requestId: 'missing-req', paymentIntentId: 'pi_real', platformFeeOre: 13000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
    expect(createNotification).not.toHaveBeenCalled();
    expect((db.find('projects', { id: 'proj-1' }) as any).status).toBe('planning'); // untouched
  });

  it('not_found when the awarded offer is missing', async () => {
    const db = seed({ offer: { id: 'a-different-offer' } });
    const r = await finalizeCommissionPayment(db.client as any, {} as any, { requestId: 'req-1', paymentIntentId: 'pi_real', platformFeeOre: 13000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
    expect(createNotification).not.toHaveBeenCalled();
  });
});
