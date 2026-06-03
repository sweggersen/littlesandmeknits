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
import { log } from '../log';

type NotifyEnv = Parameters<typeof createNotification>[2];

const ok = () => new Response('ok', { status: 200 });
const dbError = () => new Response('DB error', { status: 500 });
const dlCtx = (admin: TypedSupabaseClient, userId?: string | null) => ({
  admin,
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
  | { kind: 'listing'; id: string; sellerId: string | null; buyerId: string | null; title: string; status: string }
  | { kind: 'commission'; id: string; buyerId: string | null; title: string; status: string; awardedOfferId: string | null };

export async function findEscrowByPaymentIntent(
  admin: TypedSupabaseClient,
  intentId: string,
): Promise<Escrow | null> {
  const { data: listing } = await admin
    .from('listings')
    .select('id, seller_id, buyer_id, title, status')
    .eq('stripe_payment_intent_id', intentId)
    .maybeSingle();
  if (listing) {
    return { kind: 'listing', id: listing.id, sellerId: listing.seller_id, buyerId: listing.buyer_id, title: listing.title, status: listing.status };
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
    await recordDeadLetter(dlCtx(admin), {
      service: 'stripe.webhook:chargeback_unmatched',
      context: { dispute_id: dispute.id, payment_intent_id: intentId, reason: dispute.reason },
      error: 'No listing/commission matches the disputed payment intent',
    });
    return ok();
  }

  const reason = `stripe_chargeback:${dispute.reason ?? 'unknown'}`;
  const now = new Date().toISOString();
  const table = escrow.kind === 'listing' ? 'listings' : 'commission_requests';

  // Idempotent: only the first dispute.created for this row freezes + notifies
  // (the `stripe_dispute_id IS NULL` guard). Re-deliveries change nothing.
  const { data: changed, error } = await admin
    .from(table)
    .update({ status: 'disputed', disputed_at: now, dispute_reason: reason, stripe_dispute_id: dispute.id })
    .eq('id', escrow.id)
    .is('stripe_dispute_id', null)
    .select('id');
  if (error) {
    await recordDeadLetter(dlCtx(admin), {
      service: 'stripe.webhook:chargeback_freeze',
      context: { dispute_id: dispute.id, kind: escrow.kind, id: escrow.id },
      error,
    });
    return dbError();
  }
  if (!changed?.length) return ok(); // already frozen by an earlier delivery

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

  for (const table of ['listings', 'commission_requests'] as const) {
    const { data: rows, error } = await admin
      .from(table)
      .update({ dispute_resolution: `stripe_chargeback_${outcome}`, dispute_resolved_at: now })
      .eq('stripe_dispute_id', dispute.id)
      .is('dispute_resolved_at', null)
      .select('id, title, seller_id, buyer_id, awarded_offer_id');
    if (error) {
      await recordDeadLetter(dlCtx(admin), {
        service: 'stripe.webhook:chargeback_closed',
        context: { dispute_id: dispute.id, table, outcome },
        error,
      });
      return dbError();
    }
    const row = rows?.[0] as { id: string; title: string; seller_id?: string; buyer_id?: string; awarded_offer_id?: string } | undefined;
    if (!row) continue;

    const sellerId = table === 'listings'
      ? row.seller_id ?? null
      : await knitterIdForOffer(admin, row.awarded_offer_id ?? null);
    if (sellerId) {
      const won = outcome === 'won';
      await createNotification(admin, {
        userId: sellerId,
        type: 'dispute_resolved',
        title: won ? 'Innsigelsen ble avgjort i din favør' : 'Innsigelsen ble tapt',
        body: won
          ? `Betalingsinnsigelsen for «${row.title}» er avgjort i din favør. Beløpet frigis som normalt.`
          : `Betalingsinnsigelsen for «${row.title}» ble tapt, og beløpet er trukket tilbake av banken.`,
        url: table === 'listings' ? `/market/listing/${row.id}` : `/market/commissions/${row.id}`,
        referenceId: row.id,
      }, env);
    }
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
  await recordDeadLetter(dlCtx(admin), {
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
): Promise<Response> {
  const escrow = await findEscrowByPaymentIntent(admin, pi.id);
  await recordDeadLetter(dlCtx(admin, escrow?.buyerId ?? null), {
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
    // If the listing was already released to the seller ('sold'), a refund now
    // can drive the connected account negative — flag for reconciliation.
    if (escrow.status === 'sold') {
      await recordDeadLetter(dlCtx(admin, escrow.buyerId), {
        service: 'stripe.webhook:refund_after_payout',
        context: { listing_id: escrow.id, charge_id: charge.id, amount_refunded_ore: charge.amount_refunded },
        error: 'Refund issued after escrow was released to the seller — reconcile connected-account balance',
      });
    }
    const { error } = await admin
      .from('listings')
      .update({ refund_resolved_at: now, refund_outcome: 'accepted' })
      .eq('id', escrow.id)
      .is('refund_resolved_at', null);
    if (error) {
      await recordDeadLetter(dlCtx(admin, escrow.buyerId), {
        service: 'stripe.webhook:charge_refunded',
        context: { listing_id: escrow.id, charge_id: charge.id },
        error,
      });
      return dbError();
    }
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
  } else if (escrow.buyerId) {
    await createNotification(admin, {
      userId: escrow.buyerId,
      type: 'dispute_resolved',
      title: 'Refusjon gjennomført',
      body: `Du har fått refundert betalingen for «${escrow.title}».`,
      url: `/market/commissions/${escrow.id}`,
      referenceId: escrow.id,
    }, env);
  }
  return ok();
}
