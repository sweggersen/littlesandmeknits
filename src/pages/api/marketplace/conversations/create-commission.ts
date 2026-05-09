import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase, createAdminSupabase } from '../../../../lib/supabase';
import { createNotification } from '../../../../lib/notify';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const env = import.meta.env;
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const form = await request.formData();
  const requestId = form.get('commission_request_id')?.toString();
  const message = form.get('message')?.toString().trim();
  if (!requestId || !message) return new Response('Mangler felt', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  const { data: req } = await supabase
    .from('commission_requests')
    .select('id, buyer_id, awarded_offer_id')
    .eq('id', requestId)
    .single();

  if (!req) return new Response('Forespørsel ikke funnet', { status: 404 });

  const { data: offer } = await supabase
    .from('commission_offers')
    .select('knitter_id')
    .eq('id', req.awarded_offer_id!)
    .single();

  if (!offer) return new Response('Tilbud ikke funnet', { status: 404 });

  const isBuyer = user.id === req.buyer_id;
  const isKnitter = user.id === offer.knitter_id;
  if (!isBuyer && !isKnitter) return new Response('Ikke tilgang', { status: 403 });

  const { data: existing } = await supabase
    .from('marketplace_conversations')
    .select('id')
    .eq('commission_request_id', requestId)
    .eq('buyer_id', req.buyer_id)
    .maybeSingle();

  let conversationId: string;
  if (existing) {
    conversationId = existing.id;
  } else {
    const { data: created, error } = await supabase
      .from('marketplace_conversations')
      .insert({
        commission_request_id: requestId,
        buyer_id: req.buyer_id,
        seller_id: offer.knitter_id,
      })
      .select('id')
      .single();
    if (error || !created) {
      console.error('Commission conversation create failed', error);
      return new Response('Kunne ikke opprette samtale', { status: 500 });
    }
    conversationId = created.id;
  }

  const { error: msgErr } = await supabase
    .from('marketplace_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: message,
    });
  if (msgErr) {
    console.error('Message send failed', msgErr);
    return new Response('Kunne ikke sende melding', { status: 500 });
  }

  const recipientId = isBuyer ? offer.knitter_id : req.buyer_id;
  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  await createNotification(admin, {
    userId: recipientId,
    type: 'new_message',
    title: 'Ny melding',
    body: message.length > 80 ? message.slice(0, 77) + '…' : message,
    url: `/marked/meldinger/${conversationId}`,
    actorId: user.id,
    referenceId: conversationId,
  }, env);

  return redirect(`/marked/meldinger/${conversationId}`, 303);
};
