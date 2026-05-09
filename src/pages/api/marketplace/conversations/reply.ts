import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase, createAdminSupabase } from '../../../../lib/supabase';
import { createNotification } from '../../../../lib/notify';

// POST /api/marketplace/conversations/reply
// Either participant sends a message in an existing conversation.

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const form = await request.formData();
  const conversationId = form.get('conversation_id')?.toString();
  const body = form.get('message')?.toString().trim();
  if (!conversationId || !body) return new Response('Missing fields', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  // Verify the user is a participant (RLS handles this, but explicit is good).
  const { data: conv } = await supabase
    .from('marketplace_conversations')
    .select('id, buyer_id, seller_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return new Response('Not found', { status: 404 });

  const { error } = await supabase
    .from('marketplace_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body,
    });
  if (error) {
    console.error('Reply failed', error);
    return new Response('Could not send', { status: 500 });
  }

  const recipientId = conv.buyer_id === user.id ? conv.seller_id : conv.buyer_id;
  const env = import.meta.env;
  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  await createNotification(admin, {
    userId: recipientId,
    type: 'new_message',
    title: 'Ny melding',
    body: body.length > 80 ? body.slice(0, 77) + '…' : body,
    url: `/marked/meldinger/${conversationId}`,
    actorId: user.id,
    referenceId: conversationId,
  }, env);

  return redirect(`/marked/meldinger/${conversationId}`, 303);
};
