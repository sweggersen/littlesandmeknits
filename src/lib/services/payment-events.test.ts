import { describe, it, expect, vi } from 'vitest';
import { recordPaymentEvent } from './payment-events';
import { createFakeDb } from './__test_helpers__/fake-db';

describe('recordPaymentEvent', () => {
  it('inserts a row with the full payload, defaulting absent fields to null/{}', async () => {
    const db = createFakeDb({ payment_events: [] });
    await recordPaymentEvent(db.client as any, {
      kind: 'listing', type: 'captured', orderId: 'o1', actorId: 'seller-1',
      amountNok: 500, feeNok: 74, paymentIntentId: 'pi_1', stripeObjectId: 'ch_1',
      context: { trigger: 'ship' },
    });
    const row = db.rows('payment_events')[0] as any;
    expect(row).toMatchObject({
      kind: 'listing', event_type: 'captured', order_id: 'o1',
      commission_request_id: null, actor_id: 'seller-1', amount_nok: 500,
      fee_nok: 74, stripe_payment_intent_id: 'pi_1', stripe_object_id: 'ch_1',
      context: { trigger: 'ship' },
    });
  });

  it('defaults the optional fields when omitted (commission shape)', async () => {
    const db = createFakeDb({ payment_events: [] });
    await recordPaymentEvent(db.client as any, {
      kind: 'commission', type: 'dispute_opened', commissionRequestId: 'req-1',
    });
    const row = db.rows('payment_events')[0] as any;
    expect(row).toMatchObject({
      kind: 'commission', event_type: 'dispute_opened', commission_request_id: 'req-1',
      order_id: null, actor_id: null, amount_nok: null, fee_nok: null,
      stripe_payment_intent_id: null, stripe_object_id: null, context: {},
    });
  });

  it('is best-effort: a failing insert is swallowed (never throws into the money path)', async () => {
    const throwing = {
      from: () => ({ insert: () => { throw new Error('db down'); } }),
    };
    await expect(
      recordPaymentEvent(throwing as any, { kind: 'listing', type: 'reserved', orderId: 'o1' }),
    ).resolves.toBeUndefined();
  });

  it('logs when the insert RESOLVES with an error (supabase-js does not throw)', async () => {
    // Regression: the ledger insert returns { error } rather than throwing on a
    // DB rejection (RLS/constraint). The old try/catch missed it, silently
    // losing a ledger row. Now it must be logged.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rejecting = {
      from: () => ({ insert: async () => ({ error: { message: 'check_violation' } }) }),
    };
    await expect(
      recordPaymentEvent(rejecting as any, { kind: 'commission', type: 'captured', commissionRequestId: 'r1' }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
