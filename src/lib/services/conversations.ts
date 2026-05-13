import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createNotification } from '../notify';

export async function createConversation(
  ctx: ServiceContext,
  input: { listingId: string; message: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.listingId) return fail('bad_input', 'Missing listing');
  const message = input.message.trim();
  if (!message) return fail('bad_input', 'Message required');

  const { data: listing } = await ctx.supabase
    .from('listings').select('id, seller_id, status').eq('id', input.listingId).single();
  if (!listing || listing.status !== 'active') return fail('not_found', 'Listing not available');
  if (listing.seller_id === ctx.user.id) return fail('bad_input', 'Cannot message yourself');

  const { data: existing } = await ctx.supabase
    .from('marketplace_conversations').select('id')
    .eq('listing_id', input.listingId).eq('buyer_id', ctx.user.id).maybeSingle();

  let conversationId: string;
  if (existing) {
    conversationId = existing.id;
  } else {
    const { data: created, error } = await ctx.supabase
      .from('marketplace_conversations')
      .insert({ listing_id: input.listingId, buyer_id: ctx.user.id, seller_id: listing.seller_id })
      .select('id').single();
    if (error || !created) {
      console.error('Conversation create failed', error);
      return fail('server_error', 'Could not create conversation');
    }
    conversationId = created.id;
  }

  const { error: msgErr } = await ctx.supabase
    .from('marketplace_messages').insert({ conversation_id: conversationId, sender_id: ctx.user.id, body: message });
  if (msgErr) {
    console.error('Message send failed', msgErr);
    return fail('server_error', 'Could not send message');
  }

  return ok({ redirect: `/marked/meldinger/${conversationId}` });
}

export async function createWithCommission(
  ctx: ServiceContext,
  input: { commissionRequestId: string; message: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.commissionRequestId || !input.message.trim()) return fail('bad_input', 'Missing fields');
  const message = input.message.trim();

  const { data: req } = await ctx.supabase
    .from('commission_requests').select('id, buyer_id, awarded_offer_id')
    .eq('id', input.commissionRequestId).single();
  if (!req) return fail('not_found', 'Request not found');

  const { data: offer } = await ctx.supabase
    .from('commission_offers').select('knitter_id').eq('id', req.awarded_offer_id!).single();
  if (!offer) return fail('not_found', 'Offer not found');

  const isBuyer = ctx.user.id === req.buyer_id;
  const isKnitter = ctx.user.id === offer.knitter_id;
  if (!isBuyer && !isKnitter) return fail('forbidden', 'Forbidden');

  const { data: existing } = await ctx.supabase
    .from('marketplace_conversations').select('id')
    .eq('commission_request_id', input.commissionRequestId).eq('buyer_id', req.buyer_id).maybeSingle();

  let conversationId: string;
  if (existing) {
    conversationId = existing.id;
  } else {
    const { data: created, error } = await ctx.supabase
      .from('marketplace_conversations')
      .insert({ commission_request_id: input.commissionRequestId, buyer_id: req.buyer_id, seller_id: offer.knitter_id })
      .select('id').single();
    if (error || !created) {
      console.error('Commission conversation create failed', error);
      return fail('server_error', 'Could not create conversation');
    }
    conversationId = created.id;
  }

  const { error: msgErr } = await ctx.supabase
    .from('marketplace_messages').insert({ conversation_id: conversationId, sender_id: ctx.user.id, body: message });
  if (msgErr) {
    console.error('Message send failed', msgErr);
    return fail('server_error', 'Could not send message');
  }

  const recipientId = isBuyer ? offer.knitter_id : req.buyer_id;
  await createNotification(ctx.admin, {
    userId: recipientId, type: 'new_message',
    title: 'Ny melding',
    body: message.length > 80 ? message.slice(0, 77) + '…' : message,
    url: `/marked/meldinger/${conversationId}`,
    actorId: ctx.user.id, referenceId: conversationId,
  }, ctx.env);

  return ok({ redirect: `/marked/meldinger/${conversationId}` });
}

export async function reply(
  ctx: ServiceContext,
  input: { conversationId: string; message: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.conversationId) return fail('bad_input', 'Missing fields');
  const body = input.message.trim();
  if (!body) return fail('bad_input', 'Missing fields');

  const { data: conv } = await ctx.supabase
    .from('marketplace_conversations').select('id, buyer_id, seller_id')
    .eq('id', input.conversationId).maybeSingle();
  if (!conv) return fail('not_found', 'Not found');

  const { error } = await ctx.supabase
    .from('marketplace_messages').insert({ conversation_id: input.conversationId, sender_id: ctx.user.id, body });
  if (error) {
    console.error('Reply failed', error);
    return fail('server_error', 'Could not send');
  }

  const recipientId = conv.buyer_id === ctx.user.id ? conv.seller_id : conv.buyer_id;
  await createNotification(ctx.admin, {
    userId: recipientId, type: 'new_message',
    title: 'Ny melding',
    body: body.length > 80 ? body.slice(0, 77) + '…' : body,
    url: `/marked/meldinger/${input.conversationId}`,
    actorId: ctx.user.id, referenceId: input.conversationId,
  }, ctx.env);

  return ok({ redirect: `/marked/meldinger/${input.conversationId}` });
}
