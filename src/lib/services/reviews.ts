import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createNotification } from '../notify';
import { recalculateTrust } from '../trust';

export async function submitReview(
  ctx: ServiceContext,
  input: { commissionRequestId: string; rating: number; comment?: string },
): Promise<ServiceResult<void>> {
  if (!input.commissionRequestId || !input.rating || input.rating < 1 || input.rating > 5) {
    return fail('bad_input', 'Invalid input');
  }

  const { data: req } = await ctx.supabase
    .from('commission_requests')
    .select('id, buyer_id, status')
    .eq('id', input.commissionRequestId)
    .maybeSingle();

  if (!req || req.status !== 'delivered') {
    return fail('bad_input', 'Commission not eligible for review');
  }

  const { data: acceptedOffer } = await ctx.supabase
    .from('commission_offers')
    .select('knitter_id')
    .eq('request_id', input.commissionRequestId)
    .eq('status', 'accepted')
    .maybeSingle();

  if (!acceptedOffer) return fail('bad_input', 'No accepted offer found');

  const isBuyer = ctx.user.id === req.buyer_id;
  const isKnitter = ctx.user.id === acceptedOffer.knitter_id;
  if (!isBuyer && !isKnitter) return fail('forbidden', 'Not a participant');

  const reviewerRole = isBuyer ? 'buyer' : 'knitter';
  const revieweeId = isBuyer ? acceptedOffer.knitter_id : req.buyer_id;

  const { count: existing } = await ctx.admin
    .from('transaction_reviews')
    .select('id', { count: 'exact', head: true })
    .eq('commission_request_id', input.commissionRequestId)
    .eq('reviewer_id', ctx.user.id);

  if (existing && existing > 0) return fail('conflict', 'already_reviewed');

  await ctx.admin.from('transaction_reviews').insert({
    commission_request_id: input.commissionRequestId,
    reviewer_id: ctx.user.id,
    reviewee_id: revieweeId,
    reviewer_role: reviewerRole,
    rating: input.rating,
    comment: input.comment || null,
  });

  await createNotification(ctx.admin, {
    userId: revieweeId, type: 'review_received',
    title: 'Du har fått en ny vurdering!',
    body: `${input.rating}/5 stjerner for oppdraget.`,
    url: `/marked/oppdrag/${input.commissionRequestId}`,
    actorId: ctx.user.id, referenceId: input.commissionRequestId,
  }, ctx.env);

  await recalculateTrust(ctx.admin, revieweeId);

  return ok(undefined as void);
}
