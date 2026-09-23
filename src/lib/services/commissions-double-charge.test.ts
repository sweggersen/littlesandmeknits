import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate the double-charge logic: finalize's duplicate detection + the orphan
// refund helper. Mock the side-effect seams so we exercise the decision only.
vi.mock('../notify', () => ({ createNotification: vi.fn() }));
vi.mock('./payment-events', () => ({ recordPaymentEvent: vi.fn() }));
vi.mock('./dead-letter', () => ({ recordDeadLetter: vi.fn() }));

const refundsCreate = vi.fn(async () => ({ id: 're_1' }));
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({ refunds: { create: refundsCreate } })),
}));

import { finalizeCommissionPayment, refundOrphanCommissionCharge } from './commissions';

// Minimal admin stub: commission_requests.select().eq().maybeSingle() -> reqRow.
// The duplicate-detection branch returns before touching offers/updates.
function adminReturning(reqRow: unknown) {
  return {
    from: (t: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: t === 'commission_requests' ? reqRow : null }) }),
      }),
    }),
  } as any;
}

beforeEach(() => refundsCreate.mockClear());

describe('finalizeCommissionPayment — duplicate-charge detection', () => {
  it('treats a replay of the SAME payment intent as a benign no-op', async () => {
    const admin = adminReturning({ id: 'r1', status: 'awarded', stripe_payment_intent_id: 'pi_first' });
    const res = await finalizeCommissionPayment(admin, {} as any, {
      requestId: 'r1', paymentIntentId: 'pi_first', platformFeeOre: 1000,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.updated).toBe(false);
  });

  it('flags a DIFFERENT paid payment intent as a duplicate charge (conflict)', async () => {
    const admin = adminReturning({ id: 'r1', status: 'awarded', stripe_payment_intent_id: 'pi_first' });
    const res = await finalizeCommissionPayment(admin, {} as any, {
      requestId: 'r1', paymentIntentId: 'pi_second', platformFeeOre: 1000,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('conflict');
      expect(res.message).toContain('duplicate_charge');
    }
  });

  it('does not false-positive when the finalized request has no recorded PI', async () => {
    const admin = adminReturning({ id: 'r1', status: 'awarded', stripe_payment_intent_id: null });
    const res = await finalizeCommissionPayment(admin, {} as any, {
      requestId: 'r1', paymentIntentId: 'pi_second', platformFeeOre: 1000,
    });
    expect(res.ok).toBe(true); // benign no-op, not a duplicate
    if (res.ok) expect(res.data.updated).toBe(false);
  });
});

// Fuller stub for the happy-path finalize (status 'awaiting_payment'): the
// offer already has a linked project so ensureCommissionProject takes its short
// path (a projects update), and the terminal commission_requests update returns
// the injected error.
function adminFlow(opts: { req: unknown; offer: unknown; updateErr: unknown }) {
  return {
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: t === 'commission_requests' ? opts.req
              : t === 'commission_offers' ? opts.offer
              : t === 'profiles' ? { display_name: 'Buyer' }
              : null,
          }),
        }),
      }),
      update: () => ({
        eq: async () => ({ error: t === 'commission_requests' ? opts.updateErr : null }),
      }),
    }),
  } as any;
}

describe('finalizeCommissionPayment — write-failure handling', () => {
  it('returns server_error (NOT ok) when the status/PI update fails', async () => {
    // Buyer has been charged (auto-capture). If we returned ok() the webhook
    // would mark the event processed and Stripe would stop retrying, freezing
    // the request in awaiting_payment forever. The fail() routes to a 500 retry.
    const admin = adminFlow({
      req: {
        id: 'r1', buyer_id: 'b', status: 'awaiting_payment', awarded_offer_id: 'o1',
        title: 'Hat', yarn_provided_by_buyer: false, stripe_payment_intent_id: null,
      },
      offer: { id: 'o1', knitter_id: 'k1', project_id: 'proj1', price_nok: 500 },
      updateErr: { message: 'connection reset' },
    });
    const res = await finalizeCommissionPayment(admin, {} as any, {
      requestId: 'r1', paymentIntentId: 'pi_x', platformFeeOre: 4000,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('server_error');
      expect(res.message).toContain('connection reset');
    }
  });
});

describe('refundOrphanCommissionCharge', () => {
  it('issues a plain refund keyed idempotently to the PI', async () => {
    await refundOrphanCommissionCharge('sk_test_x', 'pi_dup');
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    const [payload, opts] = refundsCreate.mock.calls[0] as any[];
    expect(payload).toEqual({ payment_intent: 'pi_dup' });
    expect(opts.idempotencyKey).toBe('commission-dup-refund-pi_dup');
  });
});
