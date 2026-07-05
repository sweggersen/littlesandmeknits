// june26.md §1.2 — Stripe failure-mode handlers (chargebacks, payout failures,
// failed payments, refund reconciliation) + webhook idempotency.
//
// These are split out of the webhook route so they're unit-testable against a
// fake Supabase. Each handler returns a Response: 200 when handled (so the
// caller records the event as processed and Stripe won't retry), or 500 on a
// DB error (NOT recorded -> Stripe retries -> we reprocess). The money-path
// rule (CLAUDE.md): never swallow a failure — roll forward or dead-letter.

import type Stripe from 'stripe';
import type { TypedSupabaseClient } from '../supabase';
import { createNotification } from '../notify';
import { recordDeadLetter } from './dead-letter';
import { recordPaymentEvent } from './payment-events';
import { releaseExpiredReservation } from './listings';
import { log } from '../log';

type NotifyEnv = Parameters<typeof createNotification>[2];

const ok = () => new Response('ok', { status: 200 });
const dbError = () => new Response('DB error', { status: 500 });
// env is threaded so the admin dead-letter alert can push/email (not just land
// in-app) — these are the money failures most worth a phone notification.
const dlCtx = (admin: TypedSupabaseClient, env: NotifyEnv, userId?: string | null) => ({
  admin,
  env,
  user: userId ? { id: userId } : undefined,
});

function piId(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

// ── Idempotency ledger ────────────────────────────────────────────────
// We mark an event processed only AFTER success, so a retry following a 500
// still reprocesses. A second delivery of an already-processed event is a
// no-op.

export async function isEventProcessed(
  admin: TypedSupabaseClient,
  eventId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('stripe_webhook_events')
    .select('processed_at')
    .eq('event_id', eventId)
    .maybeSingle();
  return !!data?.processed_at;
}

export async function markEventProcessed(
  admin: TypedSupabaseClient,
  eventId: string,
  type: string,
): Promise<void> {
  await admin
    .from('stripe_webhook_events')
    .upsert(
      { event_id: eventId, type, processed_at: new Date().toISOString() },
      { onConflict: 'event_id' },
    );
}

// ── Correlation: Stripe charge/PI -> our escrow row ───────────────────

type Escrow =
  | { kind: 'listing'; id: string; orderId: string; sellerId: string | null; buyerId: string | null; title: string; status: string }
  | { kind: 'commission'; id: string; buyerId: string | null; title: string; status: string; awardedOfferId: string | null };

export async function findEscrowByPaymentIntent(
  admin: TypedSupabaseClient,
  intentId: string,
): Promise<Escrow | null> {
  // The PI id lives on the order now. `id` stays the LISTING id (handlers
  // update its status projection); `orderId` carries the source-of-truth row.
  const { data: order } = await admin
    .from('orders')
    .select('id, listing_id, seller_id, buyer_id, status')
    .eq('stripe_payment_intent_id', intentId)
    .maybeSingle();
  if (order) {
    const { data: l } = await admin.from('listings').select('title').eq('id', order.listing_id).maybeSingle();
    return { kind: 'listing', id: order.listing_id, orderId: order.id, sellerId: order.seller_id, buyerId: order.buyer_id, title: l?.title ?? '', status: order.status };
  }
  const { data: commission } = await admin
    .from('commission_requests')
    .select('id, buyer_id, title, status, awarded_offer_id')
    .eq('stripe_payment_intent_id', intentId)
    .maybeSingle();
  if (commission) {
    return { kind: 'commission', id: commission.id, buyerId: commission.buyer_id, title: commission.title, status: commission.status, awardedOfferId: commission.awarded_offer_id };
  }
  return null;
}

async function knitterIdForOffer(admin: TypedSupabaseClient, offerId: string | null): Promise<string | null> {
  if (!offerId) return null;
  const { data } = await admin.from('commission_offers').select('knitter_id').eq('id', offerId).maybeSingle();
  return data?.knitter_id ?? null;
}

// ── charge.dispute.created (chargeback opened) ────────────────────────
// Freeze the item into 'disputed' (this surfaces it in /admin/disputes,
// which queries status='disputed') and tell the seller. The funds are held
// by Stripe pending the dispute; we do NOT capture or release while disputed.

export async function handleChargebackOpened(
  admin: TypedSupabaseClient,
  dispute: Stripe.Dispute,
  env: NotifyEnv,
): Promise<Response> {
  const intentId = piId(dispute.payment_intent as string | { id: string } | null);
  if (!intentId) {
    log.warn('webhook.chargeback.no_payment_intent', { disputeId: dispute.id });
    return ok();
  }
  const escrow = await findEscrowByPaymentIntent(admin, intentId);
  if (!escrow) {
    // Could be a pattern/fee charge, or a row we don't track. Record so
    // support can see an unmatched chargeback rather than silently dropping.
    await recordDeadLetter(dlCtx(admin, env), {
      service: 'stripe.webhook:chargeback_unmatched',
      context: { dispute_id: dispute.id, payment_intent_id: intentId, reason: dispute.reason },
      error: 'No listing/commission matches the disputed payment intent',
    });
    return ok();
  }

  const reason = `stripe_chargeback:${dispute.reason ?? 'unknown'}`;
  const now = new Date().toISOString();

  // Freeze the source-of-truth row, idempotently (first dispute.created only,
  // via the `stripe_dispute_id IS NULL` guard). A listing chargeback freezes
  // the ORDER (which holds the dispute fields + can be post-payout) and mirrors
  // the catalog status; a commission freezes commission_requests directly.
  let changed: { id: string }[] | null;
  let freezeErr: unknown;
  if (escrow.kind === 'listing') {
    const res = await admin
      .from('orders')
      .update({ status: 'disputed', disputed_at: now, dispute_reason: reason, stripe_dispute_id: dispute.id })
      .eq('id', escrow.orderId)
      .is('stripe_dispute_id', null)
      .select('id');
    changed = res.data; freezeErr = res.error;
    if (changed?.length) {
      await admin.from('listings').update({ status: 'disputed' }).eq('id', escrow.id);
    }
  } else {
    const res = await admin
      .from('commission_requests')
      .update({ status: 'disputed', disputed_at: now, dispute_reason: reason, stripe_dispute_id: dispute.id })
      .eq('id', escrow.id)
      .is('stripe_dispute_id', null)
      .select('id');
    changed = res.data; freezeErr = res.error;
  }
  if (freezeErr) {
    await recordDeadLetter(dlCtx(admin, env), {
      service: 'stripe.webhook:chargeback_freeze',
      context: { dispute_id: dispute.id, kind: escrow.kind, id: escrow.id },
      error: freezeErr,
    });
    return dbError();
  }
  if (!changed?.length) return ok(); // already frozen by an earlier delivery

  // Ledger: a bank chargeback froze the escrow (system actor).
  await recordPaymentEvent(admin, {
    kind: escrow.kind, type: 'dispute_opened',
    orderId: escrow.kind === 'listing' ? escrow.orderId : null,
    commissionRequestId: escrow.kind === 'commission' ? escrow.id : null,
    paymentIntentId: intentId, stripeObjectId: dispute.id,
    context: { source: 'stripe_chargeback', reason: dispute.reason ?? null },
  });

  const sellerId = escrow.kind === 'listing'
    ? escrow.sellerId
    : await knitterIdForOffer(admin, escrow.awardedOfferId);
  if (sellerId) {
    await createNotification(admin, {
      userId: sellerId,
      type: 'dispute_opened',
      title: 'Betalingen er bestridt',
      body: `Kjøperen har bestridt betalingen for «${escrow.title}». Saken er til vurdering, og beløpet holdes tilbake inntil den er løst.`,
      url: escrow.kind === 'listing' ? `/market/listing/${escrow.id}` : `/market/commissions/${escrow.id}`,
      referenceId: escrow.id,
    }, env);
  }
  return ok();
}

// ── charge.dispute.closed (chargeback resolved by the bank) ───────────

export async function handleChargebackClosed(
  admin: TypedSupabaseClient,
  dispute: Stripe.Dispute,
  env: NotifyEnv,
): Promise<Response> {
  const outcome = dispute.status; // 'won' | 'lost' | 'warning_closed' | ...
  const now = new Date().toISOString();

  const resolution = `stripe_chargeback_${outcome}`;
  const won = outcome === 'won';
  const notify = async (sellerId: string | null, title: string, kind: 'listing' | 'commission', id: string) => {
    if (!sellerId) return;
    await createNotification(admin, {
      userId: sellerId,
      type: 'dispute_resolved',
      title: won ? 'Innsigelsen ble avgjort i din favør' : 'Innsigelsen ble tapt',
      body: won
        ? `Betalingsinnsigelsen for «${title}» er avgjort i din favør. Beløpet frigis som normalt.`
        : `Betalingsinnsigelsen for «${title}» ble tapt, og beløpet er trukket tilbake av banken.`,
      url: kind === 'listing' ? `/market/listing/${id}` : `/market/commissions/${id}`,
      referenceId: id,
    }, env);
  };

  // Explicit per-table calls (a dynamic .from(union) defeats the typed client).
  // The dispute fields live on the ORDER now; resolve there and notify by the
  // listing it points to.
  const { data: orows, error: lerr } = await admin
    .from('orders')
    .update({ dispute_resolution: resolution, dispute_resolved_at: now })
    .eq('stripe_dispute_id', dispute.id)
    .is('dispute_resolved_at', null)
    .select('id, listing_id, seller_id');
  if (lerr) {
    await recordDeadLetter(dlCtx(admin, env), { service: 'stripe.webhook:chargeback_closed', context: { dispute_id: dispute.id, table: 'orders', outcome }, error: lerr });
    return dbError();
  }
  if (orows?.length) {
    // Ledger: chargeback closed by the bank (won = seller keeps funds).
    await recordPaymentEvent(admin, {
      kind: 'listing', type: 'dispute_resolved', orderId: orows[0].id,
      stripeObjectId: dispute.id, context: { source: 'stripe_chargeback', outcome },
    });
    const { data: l } = await admin.from('listings').select('title').eq('id', orows[0].listing_id).maybeSingle();
    await notify(orows[0].seller_id, l?.title ?? '', 'listing', orows[0].listing_id);
    return ok();
  }

  const { data: crows, error: cerr } = await admin
    .from('commission_requests')
    .update({ dispute_resolution: resolution, dispute_resolved_at: now })
    .eq('stripe_dispute_id', dispute.id)
    .is('dispute_resolved_at', null)
    .select('id, title, awarded_offer_id');
  if (cerr) {
    await recordDeadLetter(dlCtx(admin, env), { service: 'stripe.webhook:chargeback_closed', context: { dispute_id: dispute.id, table: 'commission_requests', outcome }, error: cerr });
    return dbError();
  }
  if (crows?.length) {
    await recordPaymentEvent(admin, {
      kind: 'commission', type: 'dispute_resolved', commissionRequestId: crows[0].id,
      stripeObjectId: dispute.id, context: { source: 'stripe_chargeback', outcome },
    });
    await notify(await knitterIdForOffer(admin, crows[0].awarded_offer_id), crows[0].title, 'commission', crows[0].id);
    return ok();
  }

  return ok(); // dispute id matched nothing we track
}

// ── payout.failed (a transfer to a seller's bank bounced) ─────────────

export async function handlePayoutFailed(
  admin: TypedSupabaseClient,
  payout: Stripe.Payout,
  connectedAccountId: string | null,
  env: NotifyEnv,
): Promise<Response> {
  // A failed payout always gets dead-lettered so support can chase the bank
  // details, even when we can't map it to a known seller.
  await recordDeadLetter(dlCtx(admin, env), {
    service: 'stripe.webhook:payout_failed',
    context: {
      payout_id: payout.id,
      connected_account_id: connectedAccountId,
      amount_ore: payout.amount,
      currency: payout.currency,
      failure_code: payout.failure_code ?? null,
      failure_message: payout.failure_message ?? null,
    },
    error: `Payout failed: ${payout.failure_message ?? payout.failure_code ?? 'unknown'}`,
  });

  if (connectedAccountId) {
    const { data: seller } = await admin
      .from('seller_profiles')
      .select('id')
      .eq('stripe_account_id', connectedAccountId)
      .maybeSingle();
    if (seller?.id) {
      await createNotification(admin, {
        userId: seller.id,
        type: 'payout_failed',
        title: 'Utbetaling feilet',
        body: 'En utbetaling til kontoen din gikk ikke gjennom. Sjekk at kontonummeret er riktig under betalingsinnstillinger, så prøver vi igjen.',
        url: '/market/selger/innstillinger',
        referenceId: payout.id,
      }, env);
    }
  }
  return ok();
}

// ── payment_intent.payment_failed ─────────────────────────────────────
// For our manual-capture escrow PIs this is usually a capture that failed.
// Audit it so it isn't silently lost; the auto-release cron retries captures.

export async function handlePaymentIntentFailed(
  admin: TypedSupabaseClient,
  pi: Stripe.PaymentIntent,
  env: NotifyEnv,
): Promise<Response> {
  const escrow = await findEscrowByPaymentIntent(admin, pi.id);
  await recordDeadLetter(dlCtx(admin, env, escrow?.buyerId ?? null), {
    service: 'stripe.webhook:payment_intent_failed',
    context: {
      payment_intent_id: pi.id,
      status: pi.status,
      last_error: pi.last_payment_error?.message ?? null,
      matched: escrow ? `${escrow.kind}:${escrow.id}` : null,
    },
    error: pi.last_payment_error?.message ?? `PaymentIntent ${pi.status}`,
  });
  return ok();
}

// ── payment_intent.canceled (manual-capture auth expired or canceled) ─
// Defense-in-depth for listing escrow: Stripe auto-cancels an uncaptured auth
// ~7 days after the charge. If that happens to a still-'reserved' listing
// before the cron's ship-by sweep relists it, revert it here too. Idempotent
// with the cron via the 'reserved' status guard inside releaseExpiredReservation.
export async function handlePaymentIntentCanceled(
  admin: TypedSupabaseClient,
  pi: Stripe.PaymentIntent,
  env: { STRIPE_SECRET_KEY: string } & NotifyEnv,
): Promise<Response> {
  const escrow = await findEscrowByPaymentIntent(admin, pi.id);
  if (!escrow) return ok();
  if (escrow.kind === 'listing') {
    if (escrow.status !== 'reserved') return ok(); // already shipped/sold/disputed — stale cancel
    await releaseExpiredReservation(admin, env, { listingId: escrow.id, reason: 'auth_canceled' });
    return ok();
  }
  // Commission: the manual-capture auth can't span a multi-week knit. Surface
  // it for support rather than dropping it silently — the commission escrow
  // model needs a different mechanism (tracked separately, H2b).
  await recordDeadLetter(dlCtx(admin, env, escrow.buyerId), {
    service: 'stripe.webhook:commission_auth_canceled',
    context: { commission_request_id: escrow.id, payment_intent_id: pi.id, status: escrow.status },
    error: 'Commission PaymentIntent canceled (manual-capture auth likely expired before completion)',
  });
  return ok();
}

// ── charge.refunded (reconcile refund vs payout) ──────────────────────

export async function handleChargeRefunded(
  admin: TypedSupabaseClient,
  charge: Stripe.Charge,
  env: NotifyEnv,
): Promise<Response> {
  const intentId = piId(charge.payment_intent as string | { id: string } | null);
  if (!intentId) return ok();
  const escrow = await findEscrowByPaymentIntent(admin, intentId);
  if (!escrow) return ok();

  const now = new Date().toISOString();

  if (escrow.kind === 'listing') {
    // If the order was already delivered (released to the seller), a refund now
    // can drive the connected account negative — flag for reconciliation.
    if (escrow.status === 'delivered') {
      await recordDeadLetter(dlCtx(admin, env, escrow.buyerId), {
        service: 'stripe.webhook:refund_after_payout',
        context: { listing_id: escrow.id, charge_id: charge.id, amount_refunded_ore: charge.amount_refunded },
        error: 'Refund issued after escrow was released to the seller — reconcile connected-account balance',
      });
    }
    // Refund resolution lives on the order (keyed on PI — may be delivered).
    const { error } = await admin
      .from('orders')
      .update({ refund_resolved_at: now, refund_outcome: 'accepted' })
      .eq('stripe_payment_intent_id', intentId)
      .is('refund_resolved_at', null);
    if (error) {
      await recordDeadLetter(dlCtx(admin, env, escrow.buyerId), {
        service: 'stripe.webhook:charge_refunded',
        context: { listing_id: escrow.id, charge_id: charge.id },
        error,
      });
      return dbError();
    }
    // Ledger: refund settled on Stripe's side (amount from the charge, in ore).
    await recordPaymentEvent(admin, {
      kind: 'listing', type: 'refunded', orderId: escrow.orderId,
      actorId: escrow.buyerId, amountNok: Math.round(charge.amount_refunded / 100),
      paymentIntentId: intentId, stripeObjectId: charge.id, context: { source: 'stripe_charge_refunded' },
    });
    if (escrow.buyerId) {
      await createNotification(admin, {
        userId: escrow.buyerId,
        type: 'dispute_resolved',
        title: 'Refusjon gjennomført',
        body: `Du har fått refundert betalingen for «${escrow.title}».`,
        url: `/market/listing/${escrow.id}`,
        referenceId: escrow.id,
      }, env);
    }
  } else {
    // Commissions use separate charges & transfers: at delivery the knitter is
    // paid via transfers.create OUT of the platform balance. A refund/chargeback
    // after that does NOT auto-reverse that transfer, so the platform balance
    // eats the full price while the knitter keeps the money. Flag for manual
    // reconciliation (reverse the transfer / recover from the knitter) — mirrors
    // the listing refund_after_payout dead-letter.
    if (escrow.status === 'delivered') {
      await recordDeadLetter(dlCtx(admin, env, escrow.buyerId), {
        service: 'stripe.webhook:commission_refund_after_payout',
        context: { commission_request_id: escrow.id, charge_id: charge.id, amount_refunded_ore: charge.amount_refunded },
        error: 'Refund/chargeback after the knitter transfer was made — transfer is NOT auto-reversed; reconcile platform balance',
      });
    }
    await recordPaymentEvent(admin, {
      kind: 'commission', type: 'refunded', commissionRequestId: escrow.id,
      actorId: escrow.buyerId, amountNok: Math.round(charge.amount_refunded / 100),
      paymentIntentId: intentId, stripeObjectId: charge.id, context: { source: 'stripe_charge_refunded' },
    });
    if (escrow.buyerId) {
      await createNotification(admin, {
        userId: escrow.buyerId,
        type: 'dispute_resolved',
        title: 'Refusjon gjennomført',
        body: `Du har fått refundert betalingen for «${escrow.title}».`,
        url: `/market/commissions/${escrow.id}`,
        referenceId: escrow.id,
      }, env);
    }
  }
  return ok();
}
