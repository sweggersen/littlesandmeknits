import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createStripe } from '../stripe';
import { createNotification } from '../notify';
import { updateOpenOrder, findOpenOrder } from './orders';
import { recordPaymentEvent } from './payment-events';

const VALID_REASONS = new Set(['not_received', 'damaged', 'not_as_described', 'wrong_size', 'changed_mind', 'other']);

/** Buyer requests a refund. Sets refund_requested_at + reason on the
 *  listing. Notifies the seller. Status stays where it is (reserved/
 *  shipped/sold); the seller can accept (→ refund) or decline (→ dispute). */
export async function requestRefund(
  ctx: ServiceContext,
  input: { listingId: string; reason: string; description?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.listingId) return fail('bad_input', 'Missing listing id');
  if (!VALID_REASONS.has(input.reason)) return fail('bad_input', 'Invalid reason');

  const { data: listing } = await ctx.admin
    .from('listings').select('id, buyer_id, seller_id, title, status')
    .eq('id', input.listingId).maybeSingle();
  if (!listing) return fail('not_found', 'Listing not found');
  if (listing.buyer_id !== ctx.user.id) return fail('forbidden', 'Du er ikke kjøperen');
  if (!['reserved', 'shipped', 'sold'].includes(listing.status)) {
    return fail('conflict', 'Kan ikke be om refusjon i denne fasen');
  }
  // The refund request lives on the order now.
  const order = await findOpenOrder(ctx.admin, input.listingId);
  if (order?.refund_requested_at) return fail('conflict', 'Refusjon er allerede etterspurt');

  const reqAt = new Date().toISOString();
  await updateOpenOrder(ctx.admin, input.listingId, {
    refund_requested_at: reqAt,
    refund_reason: input.reason,
    refund_description: input.description?.slice(0, 1000) ?? null,
  });

  await createNotification(ctx.admin, {
    userId: listing.seller_id,
    type: 'dispute_opened',
    title: 'Kjøper ber om refusjon',
    body: `«${listing.title}» — du kan godta eller avvise i annonsen.`,
    url: `/market/listing/${listing.id}`,
    actorId: ctx.user.id,
    referenceId: listing.id,
  }, ctx.env);

  return ok({ redirect: `/market/listing/${listing.id}` });
}

/** Seller responds to a buyer refund request.
 *  action=accept → refund the payment intent, listing returns to active,
 *                  buyer notified, no fee charged.
 *  action=decline → opens a formal dispute (status='disputed'), moderator
 *                   takes over via existing dispute-resolution flow. */
export async function respondToRefund(
  ctx: ServiceContext,
  input: { listingId: string; action: string; notes?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!['accept', 'decline'].includes(input.action)) return fail('bad_input', 'Invalid action');

  const { data: listing } = await ctx.admin
    .from('listings').select('id, buyer_id, seller_id, title, status')
    .eq('id', input.listingId).maybeSingle();
  if (!listing) return fail('not_found', 'Listing not found');
  if (listing.seller_id !== ctx.user.id) return fail('forbidden', 'Du er ikke selgeren');
  // The refund request + payment ref live on the order.
  const order = await findOpenOrder(ctx.admin, input.listingId);
  if (!order?.refund_requested_at) return fail('conflict', 'Ingen aktiv refusjonsforespørsel');

  const now = new Date().toISOString();

  if (input.action === 'accept') {
    if (order.stripe_payment_intent_id) {
      const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);
      try {
        // Cancel (manual capture not yet captured) or refund (captured).
        await stripe.paymentIntents.cancel(order.stripe_payment_intent_id);
      } catch {
        // Already captured — full refund of the DESTINATION charge.
        // reverse_transfer pulls the funds back from the seller's connected
        // account (without it the platform balance goes negative); and
        // refund_application_fee returns our platform fee, so a full refund
        // unwinds buyer, seller and platform to zero.
        try {
          const stripe2 = createStripe(ctx.env.STRIPE_SECRET_KEY);
          await stripe2.refunds.create({
            payment_intent: order.stripe_payment_intent_id,
            reverse_transfer: true,
            refund_application_fee: true,
          });
        } catch (e) {
          console.error('Refund failed both paths', e);
          return fail('server_error', 'Kunne ikke refundere — prøv via admin/tvist');
        }
      }
    }
    // Order keeps the cancelled+refund record; listing returns to the catalog.
    await updateOpenOrder(ctx.admin, listing.id, {
      status: 'cancelled', cancelled_at: now, cancel_reason: 'refund_accepted',
      refund_resolved_at: now, refund_outcome: 'accepted',
      refund_notes: input.notes?.slice(0, 1000) ?? null,
    });
    await ctx.admin.from('listings').update({ status: 'active', buyer_id: null, sold_at: null }).eq('id', listing.id);
    // Ledger: seller accepted the refund — buyer made whole.
    await recordPaymentEvent(ctx.admin, {
      kind: 'listing', type: 'refunded', orderId: order.id, actorId: ctx.user.id,
      amountNok: order.item_price_nok + (order.shipping_nok ?? 0), feeNok: order.platform_fee_nok,
      paymentIntentId: order.stripe_payment_intent_id, context: { trigger: 'seller_accepted' },
    });

    if (listing.buyer_id) {
      await createNotification(ctx.admin, {
        userId: listing.buyer_id,
        type: 'dispute_resolved',
        title: 'Refusjon godtatt',
        body: `Selger har godtatt refusjon for «${listing.title}». Pengene er på vei tilbake.`,
        url: `/market/listing/${listing.id}`,
        actorId: ctx.user.id,
        referenceId: listing.id,
      }, ctx.env);
    }
    return ok({ redirect: `/market/listing/${listing.id}` });
  }

  // Decline → escalate to formal dispute. Moderator picks it up via /admin/disputes.
  const declineReason = `Selger avviste refusjon. Kjøpers grunn: ${order.refund_reason}.${input.notes ? ` Selgers svar: ${input.notes.slice(0, 500)}` : ''}`;
  await updateOpenOrder(ctx.admin, listing.id, {
    status: 'disputed', disputed_at: now, dispute_reason: declineReason,
    refund_resolved_at: now, refund_outcome: 'declined',
  });
  await ctx.admin.from('listings').update({ status: 'disputed' }).eq('id', listing.id);
  // Ledger: refund declined — escalated to a formal dispute (escrow frozen).
  await recordPaymentEvent(ctx.admin, {
    kind: 'listing', type: 'dispute_opened', orderId: order.id, actorId: ctx.user.id,
    paymentIntentId: order.stripe_payment_intent_id, context: { trigger: 'refund_declined' },
  });

  if (listing.buyer_id) {
    await createNotification(ctx.admin, {
      userId: listing.buyer_id,
      type: 'dispute_opened',
      title: 'Selger avviste refusjon — saken er sendt til mekling',
      body: `«${listing.title}» — moderator vil ta kontakt.`,
      url: `/market/listing/${listing.id}`,
      actorId: ctx.user.id,
      referenceId: listing.id,
    }, ctx.env);
  }
  // Also fan out to moderators so they pick it up promptly.
  const { data: mods } = await ctx.admin
    .from('profiles').select('id').in('role', ['admin', 'moderator']);
  for (const m of mods ?? []) {
    if (m.id === ctx.user.id) continue;
    await createNotification(ctx.admin, {
      userId: m.id,
      type: 'dispute_opened',
      title: `Ny tvist: ${listing.title}`,
      body: 'Refusjonsforespørsel ble avvist — trenger meglerinnsats.',
      url: `/admin/disputes/listing/${listing.id}`,
      actorId: ctx.user.id,
      referenceId: listing.id,
    }, ctx.env);
  }
  return ok({ redirect: `/market/listing/${listing.id}` });
}
