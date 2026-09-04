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

describe('refundOrphanCommissionCharge', () => {
  it('issues a plain refund keyed idempotently to the PI', async () => {
    await refundOrphanCommissionCharge('sk_test_x', 'pi_dup');
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    const [payload, opts] = refundsCreate.mock.calls[0] as any[];
    expect(payload).toEqual({ payment_intent: 'pi_dup' });
    expect(opts.idempotencyKey).toBe('commission-dup-refund-pi_dup');
  });
});
