import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeDb } from './__test_helpers__/fake-db';

// Mock notify (finalize would fan out) and Stripe (control session state).
vi.mock('../notify', () => ({ createNotification: vi.fn() }));
const recordDeadLetter = vi.fn();
vi.mock('./dead-letter', () => ({ recordDeadLetter: (...a: unknown[]) => recordDeadLetter(...a) }));
const retrieve = vi.fn();
vi.mock('../stripe', () => ({ createStripe: () => ({ checkout: { sessions: { retrieve } } }) }));

import { reconcileStuckCommissionPayments } from './commissions';

const OLD = '2026-01-01T00:00:00.000Z'; // well past any cutoff
const NOW = new Date('2026-06-01T00:00:00.000Z');

beforeEach(() => { retrieve.mockReset(); recordDeadLetter.mockClear(); });

describe('reconcileStuckCommissionPayments — selection + branching', () => {
  it('only checks stale awaiting_payment requests that have a checkout session', async () => {
    const db = createFakeDb({
      commission_requests: [
        { id: 'stuck', status: 'awaiting_payment', stripe_checkout_session_id: 'cs_1', updated_at: OLD, awarded_offer_id: 'o1' },
        { id: 'no-session', status: 'awaiting_payment', stripe_checkout_session_id: null, updated_at: OLD },
        { id: 'fresh', status: 'awaiting_payment', stripe_checkout_session_id: 'cs_2', updated_at: NOW.toISOString() },
        { id: 'already-paid', status: 'awarded', stripe_checkout_session_id: 'cs_3', updated_at: OLD },
      ],
      commission_offers: [],
    });
    retrieve.mockResolvedValue({ payment_status: 'unpaid' }); // buyer abandoned

    const r = await reconcileStuckCommissionPayments(db.client as any, 'sk_test', {} as any, { now: NOW });

    // Exactly one row qualifies (stale + has session + still awaiting_payment).
    expect(r.checked).toBe(1);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith('cs_1');
    expect(r.finalized).toBe(0); // unpaid → not finalized
  });

  it('does not finalize when Stripe still says the session is unpaid', async () => {
    const db = createFakeDb({
      commission_requests: [
        { id: 'stuck', status: 'awaiting_payment', stripe_checkout_session_id: 'cs_1', updated_at: OLD, awarded_offer_id: 'o1' },
      ],
      commission_offers: [],
    });
    retrieve.mockResolvedValue({ payment_status: 'unpaid' });

    const r = await reconcileStuckCommissionPayments(db.client as any, 'sk_test', {} as any, { now: NOW });
    expect(r.finalized).toBe(0);
    // The request is left untouched for the buyer to retry / abandon.
    expect(db.find('commission_requests', { id: 'stuck' })!.status).toBe('awaiting_payment');
  });

  it('a paid session drives finalization (delegates to finalizeCommissionPayment)', async () => {
    // Seed enough for finalize to short-circuit cleanly: a paid session whose
    // request has no awarded offer row makes finalize return not_found — proving
    // reconcile DID try to finalize the paid one (retrieve called, paid branch),
    // without needing the full project-activation happy path.
    const db = createFakeDb({
      commission_requests: [
        { id: 'stuck', status: 'awaiting_payment', stripe_checkout_session_id: 'cs_1', updated_at: OLD, awarded_offer_id: 'missing' },
      ],
      commission_offers: [],
      dead_letter_events: [],
    });
    retrieve.mockResolvedValue({ payment_status: 'paid', payment_intent: 'pi_x', metadata: { platform_fee_ore: '14400' } });

    const r = await reconcileStuckCommissionPayments(db.client as any, 'sk_test', {} as any, { now: NOW });
    expect(retrieve).toHaveBeenCalledWith('cs_1');
    // finalize couldn't complete (no offer) → finalized stays 0, but no crash.
    expect(r.checked).toBe(1);
    expect(r.finalized).toBe(0);
  });

  it('a paid session with a valid offer finalizes and counts (object payment_intent)', async () => {
    const db = createFakeDb({
      commission_requests: [
        { id: 'stuck', status: 'awaiting_payment', stripe_checkout_session_id: 'cs_1', updated_at: OLD,
          awarded_offer_id: 'o1', buyer_id: 'b1', title: 'Lue', yarn_provided_by_buyer: false },
      ],
      commission_offers: [{ id: 'o1', knitter_id: 'k1', project_id: 'p1', price_nok: 1000 }],
      projects: [{ id: 'p1', status: 'planning', started_at: null }],
      payment_events: [],
    });
    // Object-form payment_intent exercises the `?.id` extraction branch.
    retrieve.mockResolvedValue({ payment_status: 'paid', payment_intent: { id: 'pi_obj' }, metadata: { platform_fee_ore: '8000' } });

    const r = await reconcileStuckCommissionPayments(db.client as any, 'sk_test', {} as any, { now: NOW });
    expect(r.checked).toBe(1);
    expect(r.finalized).toBe(1); // finalize succeeded → counter incremented
    expect(db.find('commission_requests', { id: 'stuck' })!.status).toBe('awarded');
    expect(db.find('commission_requests', { id: 'stuck' })!.stripe_payment_intent_id).toBe('pi_obj');
  });

  it('dead-letters (does not crash the sweep) when Stripe retrieve throws', async () => {
    const db = createFakeDb({
      commission_requests: [
        { id: 'stuck', status: 'awaiting_payment', stripe_checkout_session_id: 'cs_1', updated_at: OLD, awarded_offer_id: 'o1' },
      ],
      commission_offers: [],
      dead_letter_events: [],
    });
    retrieve.mockRejectedValue(new Error('stripe down'));

    const r = await reconcileStuckCommissionPayments(db.client as any, 'sk_test', {} as any, { now: NOW });
    expect(r.checked).toBe(1);
    expect(r.finalized).toBe(0);
    expect(recordDeadLetter).toHaveBeenCalledTimes(1);
    const [, dl] = recordDeadLetter.mock.calls[0] as any[];
    expect(dl.service).toBe('commissions.reconcileStuckCommissionPayments');
    expect(dl.context.commission_request_id).toBe('stuck');
  });
});
