import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createStripe } from '../stripe';
import { createNotification } from '../notify';

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
    .from('listings').select('id, buyer_id, seller_id, title, status, refund_requested_at')
    .eq('id', input.listingId).maybeSingle();
  if (!listing) return fail('not_found', 'Listing not found');
  if (listing.buyer_id !== ctx.user.id) return fail('forbidden', 'Du er ikke kjøperen');
  if (!['reserved', 'shipped', 'sold'].includes(listing.status)) {
    return fail('conflict', 'Kan ikke be om refusjon i denne fasen');
  }
  if (listing.refund_requested_at) return fail('conflict', 'Refusjon er allerede etterspurt');

  await ctx.admin.from('listings').update({
    refund_requested_at: new Date().toISOString(),
    refund_reason: input.reason,
    refund_description: input.description?.slice(0, 1000) ?? null,
  }).eq('id', input.listingId);

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
    .from('listings').select('id, buyer_id, seller_id, title, status, stripe_payment_intent_id, refund_requested_at, refund_reason')
    .eq('id', input.listingId).maybeSingle();
  if (!listing) return fail('not_found', 'Listing not found');
  if (listing.seller_id !== ctx.user.id) return fail('forbidden', 'Du er ikke selgeren');
  if (!listing.refund_requested_at) return fail('conflict', 'Ingen aktiv refusjonsforespørsel');

  const now = new Date().toISOString();

  if (input.action === 'accept') {
    if (listing.stripe_payment_intent_id) {
      const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);
      try {
        // Cancel (manual capture not yet captured) or refund (captured).
        await stripe.paymentIntents.cancel(listing.stripe_payment_intent_id);
      } catch {
        // Already captured — full refund of the DESTINATION charge.
        // reverse_transfer pulls the funds back from the seller's connected
        // account (without it the platform balance goes negative); and
        // refund_application_fee returns our platform fee, so a full refund
        // unwinds buyer, seller and platform to zero.
        try {
          const stripe2 = createStripe(ctx.env.STRIPE_SECRET_KEY);
          await stripe2.refunds.create({
            payment_intent: listing.stripe_payment_intent_id,
            reverse_transfer: true,
            refund_application_fee: true,
          });
        } catch (e) {
          console.error('Refund failed both paths', e);
          return fail('server_error', 'Kunne ikke refundere — prøv via admin/tvist');
        }
      }
    }
    await ctx.admin.from('listings').update({
      status: 'active', buyer_id: null,
      reserved_at: null, shipped_at: null, tracking_code: null,
      delivered_at: null, sold_at: null,
      stripe_payment_intent_id: null, platform_fee_nok: null,
      refund_resolved_at: now, refund_outcome: 'accepted',
      refund_notes: input.notes?.slice(0, 1000) ?? null,
    }).eq('id', listing.id);

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
  await ctx.admin.from('listings').update({
    status: 'disputed',
    disputed_at: now,
    dispute_reason: `Selger avviste refusjon. Kjøpers grunn: ${listing.refund_reason}.${input.notes ? ` Selgers svar: ${input.notes.slice(0, 500)}` : ''}`,
    refund_resolved_at: now, refund_outcome: 'declined',
  }).eq('id', listing.id);

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
