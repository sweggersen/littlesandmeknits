import { describe, it, expect, vi } from 'vitest';
import type Stripe from 'stripe';
import { createFakeDb } from './__test_helpers__/fake-db';

// handlePaymentIntentCanceled → releaseExpiredReservation → createStripe.
// Stub the PI retrieve/cancel so the canceled-auth release path is exercised
// without a real Stripe call. (The other handlers here don't touch Stripe.)
const { piRetrieveMock, piCancelMock } = vi.hoisted(() => ({
  piRetrieveMock: vi.fn(async () => ({ status: 'requires_capture' })),
  piCancelMock: vi.fn(async () => ({ status: 'canceled' })),
}));
vi.mock('../stripe', () => ({
  createStripe: () => ({ paymentIntents: { retrieve: piRetrieveMock, cancel: piCancelMock } }),
}));

import {
  isEventProcessed,
  handleChargebackOpened,
  handleChargebackClosed,
  handlePayoutFailed,
  handlePaymentIntentFailed,
  handlePaymentIntentCanceled,
  handleChargeRefunded,
} from './stripe-events';

// Minimal Stripe object builders — only the fields the handlers read.
const dispute = (o: Partial<Stripe.Dispute>) => o as unknown as Stripe.Dispute;
const payout = (o: Partial<Stripe.Payout>) => o as unknown as Stripe.Payout;
const charge = (o: Partial<Stripe.Charge>) => o as unknown as Stripe.Charge;
const intent = (o: Partial<Stripe.PaymentIntent>) => o as unknown as Stripe.PaymentIntent;

const env = {} as never; // no Resend/VAPID -> createNotification only inserts the row

const baseSeed = () => ({ notifications: [], dead_letter_events: [] });

describe('handleChargebackOpened (listing)', () => {
  it('freezes the ORDER + mirrors the listing status, notifies the seller', async () => {
    const db = createFakeDb({
      ...baseSeed(),
      listings: [{ id: 'L1', status: 'reserved', seller_id: 'S1', title: 'Marius-genser' }],
      orders: [{ id: 'o1', listing_id: 'L1', stripe_payment_intent_id: 'pi_1', status: 'reserved', stripe_dispute_id: null, seller_id: 'S1', buyer_id: 'B1' }],
    });
    const res = await handleChargebackOpened(db.client as never, dispute({ id: 'dp_1', payment_intent: 'pi_1', reason: 'fraudulent' }), env);

    expect(res.status).toBe(200);
    const order = db.find('orders', { id: 'o1' })!;
    expect(order.status).toBe('disputed');
    expect(order.disputed_at).toBeTruthy();
    expect(order.dispute_reason).toBe('stripe_chargeback:fraudulent');
    expect(order.stripe_dispute_id).toBe('dp_1');
    expect(db.find('listings', { id: 'L1' })!.status).toBe('disputed'); // catalog mirror

    const notif = db.find('notifications', { user_id: 'S1', type: 'dispute_opened' });
    expect(notif).toBeTruthy();

    // Ledger: chargeback froze the escrow (system actor, carries the dispute id).
    expect(db.find('payment_events', { event_type: 'dispute_opened' })).toMatchObject({
      kind: 'listing', order_id: 'o1', stripe_object_id: 'dp_1',
      stripe_payment_intent_id: 'pi_1', context: { source: 'stripe_chargeback', reason: 'fraudulent' },
    });
  });

  it('is idempotent: a second delivery does not re-notify', async () => {
    const db = createFakeDb({
      ...baseSeed(),
      listings: [{ id: 'L1', status: 'disputed', seller_id: 'S1', title: 'Genser' }],
      orders: [{ id: 'o1', listing_id: 'L1', stripe_payment_intent_id: 'pi_1', status: 'disputed', stripe_dispute_id: 'dp_1', seller_id: 'S1', buyer_id: 'B1' }],
    });
    const res = await handleChargebackOpened(db.client as never, dispute({ id: 'dp_1', payment_intent: 'pi_1', reason: 'fraudulent' }), env);
    expect(res.status).toBe(200);
    expect(db.rows('notifications').length).toBe(0); // guard matched 0 rows
  });

  it('dead-letters an unmatched payment intent (no row silently dropped)', async () => {
    const db = createFakeDb({ ...baseSeed(), orders: [], commission_requests: [] });
    const res = await handleChargebackOpened(db.client as never, dispute({ id: 'dp_x', payment_intent: 'pi_unknown', reason: 'general' }), env);
    expect(res.status).toBe(200);
    const dl = db.find('dead_letter_events', { service: 'stripe.webhook:chargeback_unmatched' });
    expect(dl).toBeTruthy();
  });
});

describe('handleChargebackOpened (commission)', () => {
  it('freezes the commission and notifies the knitter', async () => {
    const db = createFakeDb({
      ...baseSeed(),
      listings: [],
      commission_requests: [{ id: 'C1', stripe_payment_intent_id: 'pi_2', status: 'completed', stripe_dispute_id: null, buyer_id: 'B1', title: 'Lue', awarded_offer_id: 'O1' }],
      commission_offers: [{ id: 'O1', knitter_id: 'K1' }],
    });
    const res = await handleChargebackOpened(db.client as never, dispute({ id: 'dp_2', payment_intent: 'pi_2', reason: 'product_not_received' }), env);
    expect(res.status).toBe(200);
    expect(db.find('commission_requests', { id: 'C1' })!.status).toBe('disputed');
    expect(db.find('notifications', { user_id: 'K1', type: 'dispute_opened' })).toBeTruthy();
    // Ledger: commission chargeback frozen.
    expect(db.find('payment_events', { event_type: 'dispute_opened' })).toMatchObject({
      kind: 'commission', commission_request_id: 'C1', stripe_object_id: 'dp_2',
    });
  });
});

describe('handleChargebackClosed', () => {
  it('records a won outcome on the order and tells the seller it was in their favour', async () => {
    const db = createFakeDb({
      ...baseSeed(),
      listings: [{ id: 'L1', seller_id: 'S1', title: 'Genser' }],
      orders: [{ id: 'o1', listing_id: 'L1', stripe_dispute_id: 'dp_1', dispute_resolved_at: null, seller_id: 'S1', buyer_id: 'B1' }],
      commission_requests: [],
    });
    const res = await handleChargebackClosed(db.client as never, dispute({ id: 'dp_1', status: 'won' }), env);
    expect(res.status).toBe(200);
    const order = db.find('orders', { id: 'o1' })!;
    expect(order.dispute_resolution).toBe('stripe_chargeback_won');
    expect(order.dispute_resolved_at).toBeTruthy();
    const notif = db.find('notifications', { user_id: 'S1', type: 'dispute_resolved' })!;
    expect(notif.title).toMatch(/favør/);
    // Ledger: chargeback closed, outcome recorded.
    expect(db.find('payment_events', { event_type: 'dispute_resolved' })).toMatchObject({
      kind: 'listing', order_id: 'o1', stripe_object_id: 'dp_1',
      context: { source: 'stripe_chargeback', outcome: 'won' },
    });
  });

  it('records a lost outcome', async () => {
    const db = createFakeDb({
      ...baseSeed(),
      listings: [{ id: 'L1', seller_id: 'S1', title: 'Genser' }],
      orders: [{ id: 'o1', listing_id: 'L1', stripe_dispute_id: 'dp_9', dispute_resolved_at: null, seller_id: 'S1' }],
      commission_requests: [],
    });
    await handleChargebackClosed(db.client as never, dispute({ id: 'dp_9', status: 'lost' }), env);
    expect(db.find('orders', { id: 'o1' })!.dispute_resolution).toBe('stripe_chargeback_lost');
    expect(db.find('notifications', { user_id: 'S1' })!.title).toMatch(/tapt/i);
  });
});

describe('handlePayoutFailed', () => {
  it('dead-letters and notifies the mapped seller', async () => {
    const db = createFakeDb({
      ...baseSeed(),
      seller_profiles: [{ id: 'S1', stripe_account_id: 'acct_1' }],
    });
    const res = await handlePayoutFailed(
      db.client as never,
      payout({ id: 'po_1', amount: 50000, currency: 'nok', failure_code: 'account_closed', failure_message: 'Konto stengt' }),
      'acct_1',
      env,
    );
    expect(res.status).toBe(200);
    expect(db.find('dead_letter_events', { service: 'stripe.webhook:payout_failed' })).toBeTruthy();
    expect(db.find('notifications', { user_id: 'S1', type: 'payout_failed' })).toBeTruthy();
  });

  it('still dead-letters when the account maps to no known seller', async () => {
    const db = createFakeDb({ ...baseSeed(), seller_profiles: [] });
    const res = await handlePayoutFailed(db.client as never, payout({ id: 'po_2', amount: 100, currency: 'nok' }), 'acct_unknown', env);
    expect(res.status).toBe(200);
    expect(db.find('dead_letter_events', { service: 'stripe.webhook:payout_failed' })).toBeTruthy();
    expect(db.rows('notifications').length).toBe(0);
  });
});

describe('handlePaymentIntentFailed', () => {
  it('audits the failure with the matched escrow row', async () => {
    const db = createFakeDb({
      ...baseSeed(),
      listings: [{ id: 'L1', status: 'reserved', seller_id: 'S1', title: 'X' }],
      orders: [{ id: 'o1', listing_id: 'L1', stripe_payment_intent_id: 'pi_3', status: 'reserved', buyer_id: 'B1', seller_id: 'S1' }],
      commission_requests: [],
    });
    const res = await handlePaymentIntentFailed(db.client as never, intent({ id: 'pi_3', status: 'requires_payment_method', last_payment_error: { message: 'card_declined' } as Stripe.PaymentIntent['last_payment_error'] }), env);
    expect(res.status).toBe(200);
    const dl = db.find('dead_letter_events', { service: 'stripe.webhook:payment_intent_failed' })!;
    expect(dl).toBeTruthy();
  });
});

describe('handleChargeRefunded', () => {
  it('reconciles a refund issued AFTER payout (order delivered) and notifies the buyer', async () => {
    const db = createFakeDb({
      ...baseSeed(),
      listings: [{ id: 'L1', status: 'sold', seller_id: 'S1', title: 'Sokker' }],
      orders: [{ id: 'o1', listing_id: 'L1', stripe_payment_intent_id: 'pi_4', status: 'delivered', buyer_id: 'B1', seller_id: 'S1', refund_resolved_at: null }],
      commission_requests: [],
    });
    const res = await handleChargeRefunded(db.client as never, charge({ id: 'ch_1', payment_intent: 'pi_4', amount_refunded: 29400 }), env);
    expect(res.status).toBe(200);
    const order = db.find('orders', { id: 'o1' })!;
    expect(order.refund_resolved_at).toBeTruthy();
    expect(order.refund_outcome).toBe('accepted');
    // Refund-after-payout must be flagged for balance reconciliation.
    expect(db.find('dead_letter_events', { service: 'stripe.webhook:refund_after_payout' })).toBeTruthy();
    expect(db.find('notifications', { user_id: 'B1' })).toBeTruthy();
    // Ledger: refund settled by Stripe (amount from the charge, in kr).
    expect(db.find('payment_events', { event_type: 'refunded' })).toMatchObject({
      kind: 'listing', order_id: 'o1', actor_id: 'B1', amount_nok: 294,
      stripe_object_id: 'ch_1', context: { source: 'stripe_charge_refunded' },
    });
  });

  it('does not flag reconciliation when the order was not yet delivered', async () => {
    const db = createFakeDb({
      ...baseSeed(),
      listings: [{ id: 'L1', status: 'reserved', seller_id: 'S1', title: 'Sokker' }],
      orders: [{ id: 'o1', listing_id: 'L1', stripe_payment_intent_id: 'pi_5', status: 'reserved', buyer_id: 'B1', seller_id: 'S1', refund_resolved_at: null }],
      commission_requests: [],
    });
    await handleChargeRefunded(db.client as never, charge({ id: 'ch_2', payment_intent: 'pi_5', amount_refunded: 29400 }), env);
    expect(db.find('dead_letter_events', { service: 'stripe.webhook:refund_after_payout' })).toBeUndefined();
  });
});

describe('isEventProcessed', () => {
  it('is true only when processed_at is set', async () => {
    const db = createFakeDb({
      stripe_webhook_events: [
        { event_id: 'evt_done', type: 'charge.refunded', processed_at: '2026-06-03T00:00:00Z' },
        { event_id: 'evt_pending', type: 'charge.refunded', processed_at: null },
      ],
    });
    expect(await isEventProcessed(db.client as never, 'evt_done')).toBe(true);
    expect(await isEventProcessed(db.client as never, 'evt_pending')).toBe(false);
    expect(await isEventProcessed(db.client as never, 'evt_absent')).toBe(false);
  });
});

describe('handlePaymentIntentCanceled (H2 defense-in-depth)', () => {
  const canceledEnv = { STRIPE_SECRET_KEY: 'sk_test', PUBLIC_SITE_URL: 'https://x.io', RESEND_API_KEY: '', PUBLIC_VAPID_KEY: '', VAPID_PRIVATE_KEY: '' } as never;

  it('releases a still-reserved listing whose auth was canceled', async () => {
    piRetrieveMock.mockResolvedValueOnce({ status: 'canceled' }); // Stripe already voided it
    // projectColumns models Postgres returning the updated rows from
    // update(...).select(), which the reservation-release race guard relies on.
    const db = createFakeDb({
      ...baseSeed(),
      listings: [{ id: 'L1', status: 'reserved', seller_id: 'S1', buyer_id: 'B1', title: 'Genser' }],
      orders: [{ id: 'o1', listing_id: 'L1', stripe_payment_intent_id: 'pi_1', status: 'reserved', seller_id: 'S1', buyer_id: 'B1', ship_deadline_at: '2026-01-06T00:00:00Z' }],
    }, { projectColumns: true });
    const res = await handlePaymentIntentCanceled(db.client as never, intent({ id: 'pi_1', status: 'canceled' }), canceledEnv);
    expect(res.status).toBe(200);
    expect(db.find('listings', { id: 'L1' })!.status).toBe('active'); // relisted
    expect(db.find('orders', { id: 'o1' })!.status).toBe('cancelled');
    expect(db.find('notifications', { user_id: 'B1', type: 'listing_reservation_released' })).toBeTruthy();
  });

  it('is a no-op for an order that already shipped (stale cancel)', async () => {
    const db = createFakeDb({
      ...baseSeed(),
      listings: [{ id: 'L1', status: 'shipped', seller_id: 'S1', buyer_id: 'B1', title: 'Genser' }],
      orders: [{ id: 'o1', listing_id: 'L1', stripe_payment_intent_id: 'pi_1', status: 'shipped', seller_id: 'S1', buyer_id: 'B1' }],
    });
    const res = await handlePaymentIntentCanceled(db.client as never, intent({ id: 'pi_1', status: 'canceled' }), canceledEnv);
    expect(res.status).toBe(200);
    expect(db.find('listings', { id: 'L1' })!.status).toBe('shipped'); // untouched
    expect(db.rows('notifications').length).toBe(0);
  });

  it('dead-letters a canceled commission auth (escrow cannot span a knit)', async () => {
    const db = createFakeDb({
      ...baseSeed(),
      listings: [],
      commission_requests: [{ id: 'C1', stripe_payment_intent_id: 'pi_2', status: 'awarded', buyer_id: 'B1', title: 'Lue', awarded_offer_id: 'O1' }],
    });
    const res = await handlePaymentIntentCanceled(db.client as never, intent({ id: 'pi_2', status: 'canceled' }), canceledEnv);
    expect(res.status).toBe(200);
    expect(db.find('dead_letter_events', { service: 'stripe.webhook:commission_auth_canceled' })).toBeTruthy();
  });

  it('200 no-op when the payment intent matches nothing', async () => {
    const db = createFakeDb({ ...baseSeed(), listings: [], commission_requests: [] });
    const res = await handlePaymentIntentCanceled(db.client as never, intent({ id: 'pi_unknown', status: 'canceled' }), canceledEnv);
    expect(res.status).toBe(200);
  });
});
