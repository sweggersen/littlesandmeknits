import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createStripe } from '../stripe';
import { createNotification } from '../notify';

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

  const { data: profile } = await ctx.admin
    .from('profiles').select('role').eq('id', ctx.user.id).maybeSingle();
  if (profile?.role !== 'admin') return fail('forbidden', 'Admin access required');

  const decision = input.decision as Decision;
  const stripe = createStripe(ctx.env.STRIPE_SECRET_KEY);
  const now = new Date().toISOString();

  if (input.itemType === 'listing') {
    return resolveListingDispute(ctx, input.itemId, decision, input.notes, stripe, now);
  }
  if (input.itemType === 'commission') {
    return resolveCommissionDispute(ctx, input.itemId, decision, input.notes, stripe, now);
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
    .select('id, seller_id, buyer_id, title, status, stripe_payment_intent_id')
    .eq('id', listingId)
    .maybeSingle();

  if (!listing) return fail('not_found', 'Listing not found');
  if (listing.status !== 'disputed') return fail('conflict', 'Not in disputed state');
  if (!listing.stripe_payment_intent_id) return fail('server_error', 'No payment intent');

  if (decision === 'refund') {
    await stripe.paymentIntents.cancel(listing.stripe_payment_intent_id);
    await ctx.admin.from('listings').update({
      status: 'active', buyer_id: null,
      dispute_resolution: notes?.trim() || 'Refunded by admin',
      dispute_resolved_at: now,
      stripe_payment_intent_id: null, platform_fee_nok: null,
      reserved_at: null, shipped_at: null, tracking_code: null,
    }).eq('id', listingId);
  } else {
    await stripe.paymentIntents.capture(listing.stripe_payment_intent_id);
    await ctx.admin.from('listings').update({
      status: 'sold', sold_at: now, delivered_at: now,
      dispute_resolution: notes?.trim() || 'Released by admin',
      dispute_resolved_at: now,
    }).eq('id', listingId);
  }

  const refunded = decision === 'refund';
  if (listing.buyer_id) {
    await createNotification(ctx.admin, {
      userId: listing.buyer_id,
      type: 'dispute_resolved',
      title: refunded ? 'Tvist løst — refundert' : 'Tvist løst — betaling frigitt',
      body: refunded
        ? `Betalingen for «${listing.title}» er refundert.`
        : `Betalingen for «${listing.title}» er frigitt til selger.`,
      url: `/marked/listing/${listingId}`,
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
      url: `/marked/listing/${listingId}`,
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

  return ok({ redirect: '/admin/tvister' });
}

async function resolveCommissionDispute(
  ctx: ServiceContext,
  requestId: string,
  decision: Decision,
  notes: string | undefined,
  stripe: ReturnType<typeof createStripe>,
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
    if (decision === 'refund') {
      await stripe.paymentIntents.cancel(req.stripe_payment_intent_id);
    } else {
      await stripe.paymentIntents.capture(req.stripe_payment_intent_id);
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
    .from('commission_offers').select('knitter_id')
    .eq('id', req.awarded_offer_id!).maybeSingle();

  const refunded = decision === 'refund';
  if (req.buyer_id) {
    await createNotification(ctx.admin, {
      userId: req.buyer_id,
      type: 'dispute_resolved',
      title: refunded ? 'Tvist løst — refundert' : 'Tvist løst — betaling frigitt',
      body: refunded
        ? `Betalingen for «${req.title}» er refundert.`
        : `Betalingen for «${req.title}» er frigitt til strikkeren.`,
      url: `/marked/oppdrag/${requestId}`,
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
      url: `/marked/oppdrag/${requestId}`,
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

  return ok({ redirect: '/admin/tvister' });
}
