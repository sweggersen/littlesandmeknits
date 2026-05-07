import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { env } from 'cloudflare:workers';
import { createStripe } from '../../../lib/stripe';
import { createAdminSupabase } from '../../../lib/supabase';

export const POST: APIRoute = async ({ request }) => {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Server not configured', { status: 503 });
  }

  const sig = request.headers.get('stripe-signature');
  if (!sig) return new Response('Missing signature', { status: 400 });

  const stripe = createStripe(env.STRIPE_SECRET_KEY);
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed', err);
    return new Response('Invalid signature', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const supabase = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

    // ── Marketplace listing fee ──────────────────────────────────
    const listingId = session.metadata?.listing_id;
    if (listingId && session.metadata?.type === 'listing_fee') {
      const { error } = await supabase
        .from('listings')
        .update({
          status: 'active',
          published_at: new Date().toISOString(),
          listing_fee_session_id: session.id,
          listing_fee_nok: session.amount_total ? Math.round(session.amount_total / 100) : 0,
        })
        .eq('id', listingId)
        .eq('status', 'draft');
      if (error) {
        console.error('Listing fee publish failed', error, { listingId });
        return new Response('DB error', { status: 500 });
      }
      return new Response('ok', { status: 200 });
    }

    // ── Pattern PDF checkout (existing flow) ─────────────────────
    const userId = session.client_reference_id ?? session.metadata?.user_id;
    const slug = session.metadata?.pattern_slug;
    if (!userId || !slug) {
      console.error('Webhook missing metadata', { userId, slug, sessionId: session.id });
      return new Response('Missing metadata', { status: 400 });
    }
    const { error } = await supabase
      .from('purchases')
      .upsert(
        {
          user_id: userId,
          pattern_slug: slug,
          stripe_session_id: session.id,
          amount_nok: session.amount_total ? Math.round(session.amount_total / 100) : 0,
          currency: (session.currency ?? 'nok').toUpperCase(),
          status: 'completed',
          pdf_path: `${slug}/v1.pdf`,
          fulfilled_at: new Date().toISOString(),
        },
        { onConflict: 'stripe_session_id' }
      );
    if (error) {
      console.error('Purchase upsert failed', error);
      return new Response('DB error', { status: 500 });
    }
  }

  return new Response('ok', { status: 200 });
};
