// Append-only money ledger writer (Phase D, see docs/ORDERS_MIGRATION.md).
//
// recordPaymentEvent appends one row per money-state transition across both
// commerce flows. It is BEST-EFFORT by design — exactly like recordDeadLetter:
// the ledger is observability, so a ledger write must NEVER be able to roll
// back a successful capture/transfer/refund. If the insert fails we log loudly
// and return; the money operation that triggered us has already committed.
//
// Always uses the admin (service_role) client: the table has no authenticated
// write policy, and callers include the Stripe webhook + cron, which have no
// session-bound client.
//
// Each row is a state-transition OBSERVATION, not a double-entry posting. The
// same money move can legitimately appear twice — once when we initiate it (a
// service decision, e.g. context.source='seller_accepted') and once when
// Stripe settles it asynchronously (context.source='stripe_charge_refunded',
// carrying the charge id). They are distinguished by context.source +
// stripe_object_id; reconciliation must group on those, not sum blindly.

import type { ServiceContext } from './types';
import type { Database } from '../database.types';
import { log } from '../log';

export type PaymentEventType = Database['public']['Enums']['payment_event_type'];

export interface PaymentEventInput {
  /** Which commerce flow. Determines which entity id is set. */
  kind: 'listing' | 'commission';
  /** The money transition. */
  type: PaymentEventType;
  /** Listing flow: the order this event belongs to. */
  orderId?: string | null;
  /** Commission flow: the request this event belongs to. */
  commissionRequestId?: string | null;
  /** Who triggered it. Omit for system actors (webhook / cron). */
  actorId?: string | null;
  /** Gross money moved (NOK). */
  amountNok?: number | null;
  /** Platform's cut of `amountNok` (NOK). */
  feeNok?: number | null;
  /** The PaymentIntent that ties the lifecycle together. */
  paymentIntentId?: string | null;
  /** The specific Stripe object for THIS event (transfer / refund / dispute / charge). */
  stripeObjectId?: string | null;
  /** Sanitised extra detail for support. No card data, no PII beyond ids. */
  context?: Record<string, unknown>;
}

/** Append a money-state transition to the ledger. Best-effort: swallows its
 *  own failure (logs it) so it can never break the money path that called it. */
export async function recordPaymentEvent(
  admin: ServiceContext['admin'],
  input: PaymentEventInput,
): Promise<void> {
  try {
    await admin.from('payment_events').insert({
      kind: input.kind,
      event_type: input.type,
      order_id: input.orderId ?? null,
      commission_request_id: input.commissionRequestId ?? null,
      actor_id: input.actorId ?? null,
      amount_nok: input.amountNok ?? null,
      fee_nok: input.feeNok ?? null,
      stripe_payment_intent_id: input.paymentIntentId ?? null,
      stripe_object_id: input.stripeObjectId ?? null,
      context: (input.context ?? {}) as Record<string, unknown> as never,
    } as never);
  } catch (e) {
    log.error('payment_event.insert_failed', {
      kind: input.kind,
      type: input.type,
      order_id: input.orderId ?? null,
      commission_request_id: input.commissionRequestId ?? null,
      error: e,
    });
  }
}
