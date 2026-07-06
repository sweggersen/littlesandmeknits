import type { ServiceContext, ServiceResult } from './types';
import { ok, fail, ensureAdmin } from './types';
import { createStripe } from '../stripe';
import { createNotification } from '../notify';
import { releaseCommissionFunds, refundCommissionPayment } from './commissions';
import { updateOpenOrder, findOpenOrder } from './orders';
import { recordPaymentEvent } from './payment-events';
import { recordDeadLetter } from './dead-letter';
import { MoneyBreakdown } from '../money';

type Decision = 'refund' | 'release';
const VALID_DECISIONS = new Set<Decision>(['refund', 'release']);

export async function resolveDispute(
  ctx: ServiceContext,
  input: {
    itemType: string;
    itemId: string;
    decision: string;
    notes?: string;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.itemId) return fail('bad_input', 'Missing item ID');
  if (!VALID_DECISIONS.has(input.decision as Decision)) return fail('bad_input', 'Invalid decision');

  const denied = await ensureAdmin(ctx);
  if (denied) return denied;

  const decision = input.decision as Decision;
  const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);
  const now = new Date().toISOString();

  if (input.itemType === 'listing') {
    return resolveListingDispute(ctx, input.itemId, decision, input.notes, stripe, now);
  }
  if (input.itemType === 'commission') {
    return resolveCommissionDispute(ctx, input.itemId, decision, input.notes, now);
  }

  return fail('bad_input', 'Invalid item type');
}

async function resolveListingDispute(
  ctx: ServiceContext,
  listingId: string,
  decision: Decision,
  notes: string | undefined,
  stripe: ReturnType<typeof createStripe>,
  now: string,
): Promise<ServiceResult<{ redirect: string }>> {
  const { data: listing } = await ctx.admin
    .from('listings')
    .select('id, seller_id, buyer_id, title, status')
    .eq('id', listingId)
    .maybeSingle();

  if (!listing) return fail('not_found', 'Listing not found');
  if (listing.status !== 'disputed') return fail('conflict', 'Not in disputed state');
  // The disputed order holds the PaymentIntent.
  const order = await findOpenOrder(ctx.admin, listingId);
  if (!order?.stripe_payment_intent_id) return fail('server_error', 'No payment intent');
  const piId = order.stripe_payment_intent_id;

  // Listing escrow is CAPTURED at ship time, so a disputed order may be either
  // pre-capture (requires_capture — dispute opened before shipping) or already
  // captured (succeeded — the common "arrived but not as described" case). The
  // old code blindly cancel()'d / capture()'d, which THROWS on a captured PI,
  // making the primary admin dispute tool 500 for the common case. Branch on
  // the real PI status and use a proper refund when already captured.
  const pi = await stripe.paymentIntents.retrieve(piId);

  if (decision === 'refund') {
    if (pi.status === 'requires_capture') {
      await stripe.paymentIntents.cancel(piId); // uncaptured hold → void it
    } else if (pi.status === 'succeeded') {
      // Captured destination charge → refund buyer, reverse the seller transfer
      // and return our platform fee, so buyer/seller/platform all net to zero.
      await stripe.refunds.create({
        payment_intent: piId,
        reverse_transfer: true,
        refund_application_fee: true,
      }, { idempotencyKey: `listing-refund-${piId}` });
    } else if (pi.status !== 'canceled') {
      await recordDeadLetter({ admin: ctx.admin }, {
        service: 'disputes.resolveListingDispute:refund-bad-state',
        context: { listing_id: listingId, order_id: order.id, payment_intent_id: piId, pi_status: pi.status },
        error: `Cannot refund a PaymentIntent in status=${pi.status}`,
      });
      return fail('conflict', 'Betalingen kan ikke refunderes i sin nåværende tilstand');
    }
    const resolution = notes?.trim() || 'Refunded by admin';
    await updateOpenOrder(ctx.admin, listingId, {
      status: 'cancelled', cancelled_at: now, cancel_reason: 'admin_refund',
      dispute_resolution: resolution, dispute_resolved_at: now,
    });
    await ctx.admin.from('listings').update({ status: 'active', buyer_id: null, sold_at: null }).eq('id', listingId);
  } else {
    if (pi.status === 'requires_capture') {
      await stripe.paymentIntents.capture(piId); // not yet captured → capture to seller now
    } else if (pi.status !== 'succeeded') {
      // succeeded = already captured at ship (funds with seller); nothing to do.
      await recordDeadLetter({ admin: ctx.admin }, {
        service: 'disputes.resolveListingDispute:release-bad-state',
        context: { listing_id: listingId, order_id: order.id, payment_intent_id: piId, pi_status: pi.status },
        error: `Cannot release a PaymentIntent in status=${pi.status}`,
      });
      return fail('conflict', 'Betalingen kan ikke frigis i sin nåværende tilstand');
    }
    const resolution = notes?.trim() || 'Released by admin';
    await updateOpenOrder(ctx.admin, listingId, {
      status: 'delivered', delivered_at: now,
      dispute_resolution: resolution, dispute_resolved_at: now,
    });
    await ctx.admin.from('listings').update({ status: 'sold', sold_at: now }).eq('id', listingId);
  }

  // Ledger: dispute closed. A refund returns the buyer's money; a release
  // captures it to the seller. Two events tell the whole story — the
  // resolution plus the underlying money move.
  await recordPaymentEvent(ctx.admin, {
    kind: 'listing', type: 'dispute_resolved', orderId: order.id, actorId: ctx.user.id,
    paymentIntentId: order.stripe_payment_intent_id, context: { decision },
  });
  await recordPaymentEvent(ctx.admin, {
    kind: 'listing', type: decision === 'refund' ? 'refunded' : 'released',
    orderId: order.id, actorId: ctx.user.id,
    amountNok: order.item_price_nok + (order.shipping_nok ?? 0), feeNok: order.platform_fee_nok,
    paymentIntentId: order.stripe_payment_intent_id, context: { trigger: 'admin_dispute' },
  });

  const refunded = decision === 'refund';
  if (listing.buyer_id) {
    await createNotification(ctx.admin, {
      userId: listing.buyer_id,
      type: 'dispute_resolved',
      title: refunded ? 'Tvist løst — refundert' : 'Tvist løst — betaling frigitt',
      body: refunded
        ? `Betalingen for «${listing.title}» er refundert.`
        : `Betalingen for «${listing.title}» er frigitt til selger.`,
      url: `/market/listing/${listingId}`,
      referenceId: listingId,
    }, ctx.env);
  }
  if (listing.seller_id) {
    await createNotification(ctx.admin, {
      userId: listing.seller_id,
      type: 'dispute_resolved',
      title: refunded ? 'Tvist løst — refundert til kjøper' : 'Tvist løst — betaling frigitt',
      body: refunded
        ? `Tvisten på «${listing.title}» er løst. Betalingen er refundert til kjøper.`
        : `Tvisten på «${listing.title}» er løst. Betalingen er frigitt til deg.`,
      url: `/market/listing/${listingId}`,
      referenceId: listingId,
    }, ctx.env);
  }

  await ctx.admin.from('moderation_audit_log').insert({
    actor_id: ctx.user.id,
    action: `dispute_${decision}`,
    target_type: 'listing',
    target_id: listingId,
    details: { decision, notes: notes?.trim() },
  });

  return ok({ redirect: '/admin/disputes' });
}

async function resolveCommissionDispute(
  ctx: ServiceContext,
  requestId: string,
  decision: Decision,
  notes: string | undefined,
  now: string,
): Promise<ServiceResult<{ redirect: string }>> {
  const { data: req } = await ctx.admin
    .from('commission_requests')
    .select('id, buyer_id, title, status, awarded_offer_id, stripe_payment_intent_id')
    .eq('id', requestId)
    .maybeSingle();

  if (!req) return fail('not_found', 'Request not found');
  if (req.status !== 'disputed') return fail('conflict', 'Not in disputed state');

  if (req.stripe_payment_intent_id) {
    const { data: awardedOffer } = await ctx.admin
      .from('commission_offers').select('knitter_id, price_nok')
      .eq('id', req.awarded_offer_id!).maybeSingle();
    if (decision === 'refund') {
      // Rail-aware: cancels an uncaptured legacy auth, plain-refunds a
      // platform-balance charge, reverse-transfers a legacy destination charge.
      await refundCommissionPayment(ctx.env.STRIPE_SECRET_KEY, req.stripe_payment_intent_id);
    } else if (awardedOffer) {
      const r = await releaseCommissionFunds(ctx.admin, ctx.env.STRIPE_SECRET_KEY, {
        requestId,
        paymentIntentId: req.stripe_payment_intent_id,
        knitterId: awardedOffer.knitter_id,
        priceNok: awardedOffer.price_nok,
      });
      // Don't record "released to knitter" if the money didn't move.
      if (!r.released) return fail('conflict', 'Utbetalingen kunne ikke gjennomføres. Se dead letters.');
    }
  }

  const newStatus = decision === 'refund' ? 'cancelled' : 'delivered';
  await ctx.admin.from('commission_requests').update({
    status: newStatus,
    dispute_resolution: notes?.trim() || `${decision} by admin`,
    dispute_resolved_at: now,
    ...(decision === 'release' ? { delivered_at: now } : {}),
  }).eq('id', requestId);

  const { data: offer } = await ctx.admin
    .from('commission_offers').select('knitter_id, price_nok')
    .eq('id', req.awarded_offer_id!).maybeSingle();

  // Ledger: dispute closed + the underlying money move (commission flow).
  // On release the knitter is paid the price minus the platform's commission;
  // on refund the buyer's money is returned (no fee retained).
  await recordPaymentEvent(ctx.admin, {
    kind: 'commission', type: 'dispute_resolved', commissionRequestId: requestId,
    actorId: ctx.user.id, paymentIntentId: req.stripe_payment_intent_id, context: { decision },
  });
  await recordPaymentEvent(ctx.admin, {
    kind: 'commission', type: decision === 'refund' ? 'refunded' : 'released',
    commissionRequestId: requestId, actorId: ctx.user.id,
    amountNok: offer?.price_nok ?? null,
    feeNok: decision === 'release' && offer
      ? Math.round(MoneyBreakdown.commissionPayment({ priceNok: offer.price_nok }).platformFeeOre / 100) : null,
    paymentIntentId: req.stripe_payment_intent_id, context: { trigger: 'admin_dispute' },
  });

  const refunded = decision === 'refund';
  if (req.buyer_id) {
    await createNotification(ctx.admin, {
      userId: req.buyer_id,
      type: 'dispute_resolved',
      title: refunded ? 'Tvist løst — refundert' : 'Tvist løst — betaling frigitt',
      body: refunded
        ? `Betalingen for «${req.title}» er refundert.`
        : `Betalingen for «${req.title}» er frigitt til strikkeren.`,
      url: `/market/commissions/${requestId}`,
      referenceId: requestId,
    }, ctx.env);
  }
  if (offer) {
    await createNotification(ctx.admin, {
      userId: offer.knitter_id,
      type: 'dispute_resolved',
      title: refunded ? 'Tvist løst — refundert til kjøper' : 'Tvist løst — betaling frigitt',
      body: refunded
        ? `Tvisten på «${req.title}» er løst. Betalingen er refundert til kjøper.`
        : `Tvisten på «${req.title}» er løst. Betalingen er frigitt til deg.`,
      url: `/market/commissions/${requestId}`,
      referenceId: requestId,
    }, ctx.env);
  }

  await ctx.admin.from('moderation_audit_log').insert({
    actor_id: ctx.user.id,
    action: `dispute_${decision}`,
    target_type: 'commission_request',
    target_id: requestId,
    details: { decision, notes: notes?.trim() },
  });

  return ok({ redirect: '/admin/disputes' });
}
