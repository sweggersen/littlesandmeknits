import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createNotification } from '../notify';
import { recalculateTrust } from '../trust';

export async function submitSellerReview(
  ctx: ServiceContext,
  input: { listingId: string; rating: number; comment?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.listingId || !input.rating || input.rating < 1 || input.rating > 5) {
    return fail('bad_input', 'Invalid input');
  }

  const { data: listing } = await ctx.supabase
    .from('listings')
    .select('id, seller_id, buyer_id, title, status')
    .eq('id', input.listingId)
    .maybeSingle();

  if (!listing) return fail('not_found', 'Listing not found');
  if (listing.status !== 'sold') return fail('conflict', 'Listing not delivered yet');
  if (listing.buyer_id !== ctx.user.id) return fail('forbidden', 'Only the buyer can review');

  const { count: existing } = await ctx.admin
    .from('seller_reviews')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', listing.seller_id)
    .eq('reviewer_id', ctx.user.id)
    .eq('listing_id', input.listingId);

  if (existing && existing > 0) return fail('conflict', 'Already reviewed');

  const { error } = await ctx.admin.from('seller_reviews').insert({
    seller_id: listing.seller_id,
    reviewer_id: ctx.user.id,
    listing_id: input.listingId,
    rating: input.rating,
    comment: input.comment?.trim() || null,
  });

  if (error) {
    console.error('Seller review insert failed', error);
    return fail('server_error', 'Could not save review');
  }

  await createNotification(ctx.admin, {
    userId: listing.seller_id,
    type: 'review_received',
    title: 'Du har fått en ny vurdering!',
    body: `${input.rating}/5 stjerner for «${listing.title}».`,
    url: `/marked/listing/${input.listingId}`,
    actorId: ctx.user.id,
    referenceId: input.listingId,
  }, ctx.env);

  await recalculateTrust(ctx.admin, listing.seller_id);

  return ok({ redirect: `/marked/listing/${input.listingId}` });
}
