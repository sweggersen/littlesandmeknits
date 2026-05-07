import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

// POST /api/marketplace/conversations/create
// Buyer starts (or resumes) a conversation about a listing.
// If a conversation already exists for this listing+buyer pair,
// redirect to it instead of creating a duplicate.

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  const form = await request.formData();
  const listingId = form.get('listing_id')?.toString();
  if (!listingId) return new Response('Missing listing', { status: 400 });
  if (!user) return redirect(`/logg-inn?next=${encodeURIComponent(`/marked/listing/${listingId}`)}`);

  const message = form.get('message')?.toString().trim();
  if (!message) return new Response('Message required', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  const { data: listing } = await supabase
    .from('listings')
    .select('id, seller_id, status')
    .eq('id', listingId)
    .single();
  if (!listing || listing.status !== 'active') {
    return new Response('Listing not available', { status: 404 });
  }
  if (listing.seller_id === user.id) {
    return new Response('Cannot message yourself', { status: 400 });
  }

  // Upsert conversation (unique on listing_id + buyer_id).
  const { data: existing } = await supabase
    .from('marketplace_conversations')
    .select('id')
    .eq('listing_id', listingId)
    .eq('buyer_id', user.id)
    .maybeSingle();

  let conversationId: string;
  if (existing) {
    conversationId = existing.id;
  } else {
    const { data: created, error } = await supabase
      .from('marketplace_conversations')
      .insert({
        listing_id: listingId,
        buyer_id: user.id,
        seller_id: listing.seller_id,
      })
      .select('id')
      .single();
    if (error || !created) {
      console.error('Conversation create failed', error);
      return new Response('Could not create conversation', { status: 500 });
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
    return new Response('Could not send message', { status: 500 });
  }

  return redirect(`/studio/marked/meldinger/${conversationId}`, 303);
};
