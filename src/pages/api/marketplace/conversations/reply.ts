import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

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

  return redirect(`/studio/marked/meldinger/${conversationId}`, 303);
};
