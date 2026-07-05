import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payCommission, finalizeCommissionPayment, releaseCommissionFunds, refundCommissionPayment, makeOffer, knitterCompletedCount, cancelLateCommission } from './commissions';
import { createNotification } from '../notify';
import { recordDeadLetter } from './dead-letter';
import { createFakeDb, type FakeDb } from './__test_helpers__/fake-db';
import type { ServiceContext } from './types';
import { commissionFeeNok } from '../commission-pricing';

// Projection on: reads return only selected columns, so a dropped/blanked
// `.select(...)` surfaces as a missing field (kills column-list mutants).
const fakeDb = (seed: Record<string, Record<string, unknown>[]>) =>
  createFakeDb(seed, { projectColumns: true });

// Money-math + side-effect coverage for commission payment (separate charges &
// transfers): payCommission builds a hosted Checkout Session that auto-captures
// into the platform balance; finalizeCommissionPayment (webhook) records the
// payment; releaseCommissionFunds transfers the knitter's share at delivery.

vi.mock('../notify', () => ({ createNotification: vi.fn() }));
vi.mock('./dead-letter', () => ({ recordDeadLetter: vi.fn() }));

const sessionCreate = vi.fn(async (_args?: any) => ({ url: 'https://checkout.stripe.com/c/sess_1' }));
const piRetrieve = vi.fn(async (_id?: any): Promise<any> => ({ status: 'succeeded', transfer_data: null, latest_charge: 'ch_1' }));
const piCapture = vi.fn(async (_id?: any) => ({}));
const piCancel = vi.fn(async (_id?: any) => ({}));
const transferCreate = vi.fn(async (_args?: any, _opts?: any) => ({ id: 'tr_1' }));
const refundCreate = vi.fn(async (_args?: any) => ({}));
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({
    checkout: { sessions: { create: sessionCreate } },
    paymentIntents: { retrieve: piRetrieve, capture: piCapture, cancel: piCancel },
    transfers: { create: transferCreate },
    refunds: { create: refundCreate },
  })),
}));

beforeEach(() => {
  sessionCreate.mockClear();
  piRetrieve.mockClear();
  piCapture.mockClear();
  piCancel.mockClear();
  transferCreate.mockClear();
  refundCreate.mockClear();
  vi.mocked(recordDeadLetter).mockClear();
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

describe('payCommission — builds a real Checkout Session (separate charges & transfers)', () => {
  it('charges price + 8% fee into the PLATFORM balance, fee recorded in metadata', async () => {
    const db = seed();
    const r = await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toBe('https://checkout.stripe.com/c/sess_1');

    expect(sessionCreate).toHaveBeenCalledTimes(1);
    const args = sessionCreate.mock.calls[0][0] as any;
    expect(args.mode).toBe('payment');
    // Buyer pays the knitter's price PLUS the fee on top — two line items.
    expect(args.line_items[0].price_data.unit_amount).toBe(100000); // 1000 kr knit price
    expect(args.line_items[1].price_data.unit_amount).toBe(8000);   // 8% fee = 80 kr
    expect(args.line_items[1].price_data.product_data.name).toContain('gebyr');
    // H2b: NO payment_intent_data — no manual capture (the auth would die in
    // ~7 days, a knit takes weeks) and no destination/application fee. The
    // charge auto-captures into the platform balance; the knitter's share is
    // transferred at delivery by releaseCommissionFunds.
    expect(args.payment_intent_data).toBeUndefined();
    expect(args.line_items[0].price_data.currency).toBe('nok');
    expect(args.line_items[0].price_data.product_data.name).toContain('Strikket teppe');
    expect(args.payment_method_types).toEqual(expect.arrayContaining(['vipps', 'card']));
    expect(args.success_url).toBe('https://test.site/market/commissions/req-1?paid=1');
    expect(args.cancel_url).toBe('https://test.site/market/commissions/req-1');
    expect(args.customer_email).toBe('buyer@x.io'); // prefilled so Vipps/card receipt reaches the buyer
    expect(args.locale).toBe('nb');
    expect(args.metadata).toMatchObject({ type: 'commission_payment', commission_request_id: 'req-1', buyer_id: 'buyer-1', platform_fee_ore: '8000' });

    // No side effects here — the request stays awaiting_payment until the webhook.
    const row = db.find('commission_requests', { id: 'req-1' }) as any;
    expect(row.status).toBe('awaiting_payment');
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('falls back to the production site URL when PUBLIC_SITE_URL is unset', async () => {
    const ctx = ctxFor(seed());
    delete (ctx.env as any).PUBLIC_SITE_URL;
    await payCommission(ctx, { requestId: 'req-1' });
    expect((sessionCreate.mock.calls[0][0] as any).success_url).toContain('https://www.littlesandmeknits.com');
  });

  // Price sweep: fee is 8% flat (terms §5), paid by the buyer ON TOP. Two line
  // items (knit price + fee); metadata echoes the fee the webhook stores.
  it.each([1, 50, 199, 200, 999, 1000, 4999, 5000])(
    'price %d kr — 8%% fee on top reconciles', async (price) => {
      const db = seed({ offer: { price_nok: price } });
      await payCommission(ctxFor(db), { requestId: 'req-1' });
      const args = sessionCreate.mock.calls[0][0] as any;
      const priceOre = price * 100;
      // The money authority rounds the fee to whole kroner (matching the buyer
      // display), so it can be 0 for a trivially small price (no fee line item).
      const expectedFeeOre = commissionFeeNok(price) * 100;
      expect(args.line_items[0].price_data.unit_amount).toBe(priceOre);   // knitter's full price
      expect(args.metadata.platform_fee_ore).toBe(String(expectedFeeOre));
      if (expectedFeeOre > 0) {
        expect(args.line_items[1].price_data.unit_amount).toBe(expectedFeeOre); // fee on top
      } else {
        expect(args.line_items).toHaveLength(1); // fee rounds to 0 → no fee line
      }
    },
  );
});

describe('payCommission — guards', () => {
  it('rejects empty request id', async () => {
    const r = await payCommission(ctxFor(seed()), { requestId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('bad_input'); expect(r.message).toBeTruthy(); }
  });

  it('forbids paying someone else’s request', async () => {
    const r = await payCommission(ctxFor(seed(), 'not-the-buyer'), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('forbidden'); expect(r.message).toBeTruthy(); }
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('rejects a request not in awaiting_payment', async () => {
    const r = await payCommission(ctxFor(seed({ req: { status: 'open' } })), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('bad_input'); expect(r.message).toBeTruthy(); }
  });

  it('not_found when the awarded offer is missing', async () => {
    const r = await payCommission(ctxFor(seed({ offer: { id: 'a-different-offer' } })), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('not_found'); expect(r.message).toBeTruthy(); }
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('refuses to collect money for a knitter without verified payouts', async () => {
    const r = await payCommission(ctxFor(seed({ connect: { stripe_account_id: null, stripe_connect_status: 'pending' } })), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('conflict'); expect(r.message).toBeTruthy(); }
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('refuses when verified but missing the payout account id', async () => {
    const r = await payCommission(ctxFor(seed({ connect: { stripe_account_id: null, stripe_connect_status: 'verified' } })), { requestId: 'req-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('conflict'); expect(r.message).toBeTruthy(); }
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
    if (!r.ok) { expect(r.code).toBe('conflict'); expect(r.message).toBeTruthy(); }
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('charges 8% flat regardless of knitter role (no profiles dependency)', async () => {
    const db = fakeDb({
      commission_requests: [{ id: 'req-1', buyer_id: 'buyer-1', status: 'awaiting_payment', awarded_offer_id: 'offer-1', title: 'T', yarn_provided_by_buyer: false }],
      commission_offers: [{ id: 'offer-1', knitter_id: 'knitter-1', price_nok: 1000 }],
      // No profiles row at all — the fee is flat 8% per terms §5.
      seller_profiles: [{ id: 'knitter-1', stripe_account_id: 'acct_knitter', stripe_connect_status: 'verified' }],
    });
    const r = await payCommission(ctxFor(db), { requestId: 'req-1' });
    expect(r.ok).toBe(true);
    expect((sessionCreate.mock.calls[0][0] as any).metadata.platform_fee_ore).toBe('8000');
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
    if (!r.ok) { expect(r.code).toBe('server_error'); expect(r.message).toBeTruthy(); }
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

    // Ledger: commission 'captured' into the platform balance (full price held;
    // the knitter is paid later). Buyer is the actor; fee is the platform cut.
    expect(db.find('payment_events', { event_type: 'captured' })).toMatchObject({
      kind: 'commission', commission_request_id: 'req-1', actor_id: 'buyer-1',
      amount_nok: 1000, fee_nok: 130, stripe_payment_intent_id: 'pi_real',
    });

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
    if (!r.ok) { expect(r.code).toBe('not_found'); expect(r.message).toBeTruthy(); }
    expect(createNotification).not.toHaveBeenCalled();
    expect((db.find('projects', { id: 'proj-1' }) as any).status).toBe('planning'); // untouched
  });

  it('not_found when the awarded offer is missing', async () => {
    const db = seed({ offer: { id: 'a-different-offer' } });
    const r = await finalizeCommissionPayment(db.client as any, {} as any, { requestId: 'req-1', paymentIntentId: 'pi_real', platformFeeOre: 13000 });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('not_found'); expect(r.message).toBeTruthy(); }
    expect(createNotification).not.toHaveBeenCalled();
  });
});

// H2b: the transfer at delivery — the money-critical release step.
describe('releaseCommissionFunds', () => {
  const args = { requestId: 'req-1', paymentIntentId: 'pi_paid', knitterId: 'knitter-1', priceNok: 1000 };

  it('new rail: transfers the FULL price to the knitter, tied to the charge, idempotent key', async () => {
    const db = seed();
    const r = await releaseCommissionFunds(db.client as any, 'sk_test', args);
    expect(r.released).toBe(true);
    expect(piCapture).not.toHaveBeenCalled();
    expect(transferCreate).toHaveBeenCalledTimes(1);
    const [params, opts] = transferCreate.mock.calls[0];
    expect(params).toMatchObject({
      amount: 100000, // full price — buyer paid the 8% fee on top; platform keeps it
      currency: 'nok',
      destination: 'acct_knitter',
      source_transaction: 'ch_1',
      transfer_group: 'commission_req-1',
    });
    expect(params.metadata.platform_fee_ore).toBe('8000');
    // The idempotency key makes a confirm/cron race yield ONE transfer.
    expect(opts.idempotencyKey).toBe('commission-transfer-req-1');
    // Transfer id recorded for audit.
    expect((db.find('commission_requests', { id: 'req-1' }) as any).stripe_transfer_id).toBe('tr_1');
  });

  // Money conservation across the sweep (buyer-pays-on-top): the knitter is
  // transferred the FULL price, and the platform retains the 8% fee the buyer
  // paid on top. So knitter transfer + platform fee = buyer total (price + fee).
  it.each([1, 50, 199, 200, 999, 1000, 4999, 5000])('conserves money at %d kr', async (price) => {
    const db = seed();
    await releaseCommissionFunds(db.client as any, 'sk_test', { ...args, priceNok: price });
    const [params] = transferCreate.mock.calls[0];
    const feeOre = commissionFeeNok(price) * 100;         // whole-kroner fee (authority)
    const buyerTotalOre = price * 100 + feeOre;
    expect(params.amount).toBe(price * 100);              // knitter gets 100%
    expect(params.amount + feeOre).toBe(buyerTotalOre);   // + platform fee = buyer total
    expect(params.metadata.platform_fee_ore).toBe(String(feeOre));
  });

  it('legacy rail requires_capture: captures (transfer_data routes), no transfer', async () => {
    piRetrieve.mockResolvedValueOnce({ status: 'requires_capture' });
    const db = seed();
    const r = await releaseCommissionFunds(db.client as any, 'sk_test', args);
    expect(r.released).toBe(true);
    expect(piCapture).toHaveBeenCalledWith('pi_paid');
    expect(transferCreate).not.toHaveBeenCalled();
  });

  it('legacy rail already captured (has transfer_data): nothing to do', async () => {
    piRetrieve.mockResolvedValueOnce({ status: 'succeeded', transfer_data: { destination: 'acct_knitter' } });
    const db = seed();
    const r = await releaseCommissionFunds(db.client as any, 'sk_test', args);
    expect(r.released).toBe(true);
    expect(piCapture).not.toHaveBeenCalled();
    expect(transferCreate).not.toHaveBeenCalled();
  });

  it('refuses when the auth died (canceled): dead-letters, releases nothing', async () => {
    piRetrieve.mockResolvedValueOnce({ status: 'canceled' });
    const db = seed();
    const r = await releaseCommissionFunds(db.client as any, 'sk_test', args);
    expect(r.released).toBe(false);
    expect(transferCreate).not.toHaveBeenCalled();
    expect(recordDeadLetter).toHaveBeenCalledTimes(1);
  });

  it('refuses when the knitter has no payout account: dead-letters, no transfer', async () => {
    const db = seed({ connect: { stripe_account_id: null } });
    const r = await releaseCommissionFunds(db.client as any, 'sk_test', args);
    expect(r.released).toBe(false);
    expect(r.reason).toBe('no_payout_account');
    expect(transferCreate).not.toHaveBeenCalled();
    expect(recordDeadLetter).toHaveBeenCalledTimes(1);
  });

  it('refuses when the seller_profiles row is missing entirely', async () => {
    const db = fakeDb({
      commission_requests: [{ id: 'req-1', buyer_id: 'buyer-1', status: 'completed', awarded_offer_id: 'offer-1', title: 'T', yarn_provided_by_buyer: false }],
      commission_offers: [{ id: 'offer-1', knitter_id: 'knitter-1', price_nok: 1000 }],
      // No seller_profiles at all.
    });
    const r = await releaseCommissionFunds(db.client as any, 'sk_test', args);
    expect(r.released).toBe(false);
    expect(r.reason).toBe('no_payout_account');
    expect(transferCreate).not.toHaveBeenCalled();
  });

  it('unwraps an expanded latest_charge object for source_transaction', async () => {
    piRetrieve.mockResolvedValueOnce({ status: 'succeeded', transfer_data: null, latest_charge: { id: 'ch_expanded' } });
    const db = seed();
    await releaseCommissionFunds(db.client as any, 'sk_test', args);
    expect(transferCreate.mock.calls[0][0].source_transaction).toBe('ch_expanded');
  });

  it('omits source_transaction when the charge id is unavailable', async () => {
    piRetrieve.mockResolvedValueOnce({ status: 'succeeded', transfer_data: null, latest_charge: null });
    const db = seed();
    const r = await releaseCommissionFunds(db.client as any, 'sk_test', args);
    expect(r.released).toBe(true);
    expect('source_transaction' in transferCreate.mock.calls[0][0]).toBe(false);
  });
});

// H2b: refunds back to the buyer must match the rail the money took.
describe('refundCommissionPayment', () => {
  it('no-op when the PI is already canceled', async () => {
    piRetrieve.mockResolvedValueOnce({ status: 'canceled' });
    await refundCommissionPayment('sk_test', 'pi_x');
    expect(piCancel).not.toHaveBeenCalled();
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('cancels an uncaptured legacy auth (returns the hold, no refund object)', async () => {
    piRetrieve.mockResolvedValueOnce({ status: 'requires_capture' });
    await refundCommissionPayment('sk_test', 'pi_x');
    expect(piCancel).toHaveBeenCalledWith('pi_x');
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('plain refund for a new-rail charge (platform balance, NO reverse_transfer)', async () => {
    // default piRetrieve: succeeded, transfer_data null
    await refundCommissionPayment('sk_test', 'pi_x');
    // Idempotency key (per PI) prevents a double refund on retry.
    expect(refundCreate).toHaveBeenCalledWith({ payment_intent: 'pi_x' }, { idempotencyKey: 'commission-refund-pi_x' });
    expect(piCancel).not.toHaveBeenCalled();
  });

  it('reverse-transfer refund for a legacy destination charge', async () => {
    piRetrieve.mockResolvedValueOnce({ status: 'succeeded', transfer_data: { destination: 'acct_knitter' } });
    await refundCommissionPayment('sk_test', 'pi_x');
    expect(refundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_x', reverse_transfer: true, refund_application_fee: true },
      { idempotencyKey: 'commission-refund-pi_x' },
    );
  });
});

describe('makeOffer — buyer-yarn requires a proven knitter (P0.3)', () => {
  const offerInput = { requestId: 'req-1', priceNok: '1000', turnaroundWeeks: '3', message: 'Jeg kan strikke dette!' };

  it('counts a knitter\'s delivered commissions', async () => {
    const db = createFakeDb({
      commission_offers: [
        { id: 'o1', request_id: 'r-done', knitter_id: 'knitter-1', status: 'accepted' },
        { id: 'o2', request_id: 'r-open', knitter_id: 'knitter-1', status: 'accepted' },
      ],
      commission_requests: [
        { id: 'r-done', status: 'delivered' },
        { id: 'r-open', status: 'awarded' },
      ],
    });
    expect(await knitterCompletedCount(db.client as any, 'knitter-1')).toBe(1);
    expect(await knitterCompletedCount(db.client as any, 'nobody')).toBe(0);
  });

  it('rejects an unproven knitter (0 delivered) on a buyer-yarn request', async () => {
    const db = createFakeDb({
      commission_requests: [{ id: 'req-1', buyer_id: 'buyer-1', status: 'open', title: 'Genser', yarn_provided_by_buyer: true }],
      commission_offers: [],
    });
    const r = await makeOffer(ctxFor(db, 'knitter-new'), offerInput);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('conflict'); expect(r.message).toMatch(/garn/i); }
  });

  it('allows a proven knitter (≥1 delivered) on a buyer-yarn request', async () => {
    const db = createFakeDb({
      commission_requests: [
        { id: 'req-1', buyer_id: 'buyer-1', status: 'open', title: 'Genser', yarn_provided_by_buyer: true },
        { id: 'r-done', buyer_id: 'buyer-2', status: 'delivered', title: 'Old' },
      ],
      commission_offers: [{ id: 'o-done', request_id: 'r-done', knitter_id: 'knitter-1', status: 'accepted', price_nok: 500 }],
    });
    const r = await makeOffer(ctxFor(db, 'knitter-1'), offerInput);
    expect(r.ok).toBe(true);
    expect(db.find('commission_offers', { request_id: 'req-1', knitter_id: 'knitter-1' })).toBeTruthy();
  });

  it('does not gate a request where the knitter supplies the yarn', async () => {
    const db = createFakeDb({
      commission_requests: [{ id: 'req-1', buyer_id: 'buyer-1', status: 'open', title: 'Genser', yarn_provided_by_buyer: false }],
      commission_offers: [],
    });
    const r = await makeOffer(ctxFor(db, 'knitter-new'), offerInput);
    expect(r.ok).toBe(true);
  });
});

describe('cancelLateCommission — buyer cancels an overdue commission (P1.1)', () => {
  const NOW = new Date('2026-03-01T00:00:00.000Z');
  const overdue = '2026-02-01T00:00:00.000Z'; // > 7 days before NOW
  const soon = '2026-02-27T00:00:00.000Z';    // < 7 days before NOW

  function seedInProgress(over: Record<string, unknown> = {}) {
    return createFakeDb({
      commission_requests: [{
        id: 'req-1', buyer_id: 'buyer-1', status: 'awarded', title: 'Genser',
        needed_by: overdue, stripe_payment_intent_id: 'pi_c', awarded_offer_id: 'o1', ...over,
      }],
      commission_offers: [{ id: 'o1', knitter_id: 'knitter-1', status: 'accepted', price_nok: 1000 }],
    });
  }

  it('refunds + cancels + notifies when overdue past the grace window', async () => {
    const db = seedInProgress();
    const r = await cancelLateCommission(ctxFor(db, 'buyer-1'), { requestId: 'req-1', now: NOW });
    expect(r.ok).toBe(true);
    expect(refundCreate).toHaveBeenCalledTimes(1); // buyer refunded (idempotent)
    expect((db.find('commission_requests', { id: 'req-1' }) as any).status).toBe('cancelled');
    expect(db.find('payment_events', { event_type: 'refunded' })).toMatchObject({
      kind: 'commission', commission_request_id: 'req-1', context: { trigger: 'buyer_late_cancel' },
    });
    const [, payload] = vi.mocked(createNotification).mock.calls[0];
    expect(payload).toMatchObject({ userId: 'knitter-1', type: 'commission_cancelled' });
  });

  it('refuses before the grace window has passed', async () => {
    const db = seedInProgress({ needed_by: soon });
    const r = await cancelLateCommission(ctxFor(db, 'buyer-1'), { requestId: 'req-1', now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('refuses for a non-buyer', async () => {
    const db = seedInProgress();
    const r = await cancelLateCommission(ctxFor(db, 'someone-else'), { requestId: 'req-1', now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('refuses in a non-in-progress state (e.g. completed = dispute territory)', async () => {
    const db = seedInProgress({ status: 'completed' });
    const r = await cancelLateCommission(ctxFor(db, 'buyer-1'), { requestId: 'req-1', now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('refuses when no deadline was agreed (needed_by null)', async () => {
    const db = seedInProgress({ needed_by: null });
    const r = await cancelLateCommission(ctxFor(db, 'buyer-1'), { requestId: 'req-1', now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });
});
