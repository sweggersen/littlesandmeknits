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

  const supabase = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

  // ─────────────────────────────────────────────────────────────────
  // Pattern PDF checkout (existing flow)
  // ─────────────────────────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.marketplace_order_id;

    // Marketplace order purchased via Checkout (pre-loved / ready-made flow).
    if (orderId) {
      const { error } = await supabase
        .from('marketplace_orders')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          stripe_payment_intent_id: typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
        })
        .eq('id', orderId)
        .eq('status', 'pending_payment');
      if (error) {
        console.error('Order paid update failed', error, { orderId });
        return new Response('DB error', { status: 500 });
      }
      // Reserve the listing so it disappears from the public list.
      const listingId = session.metadata?.listing_id;
      if (listingId) {
        await supabase
          .from('listings')
          .update({ status: 'reserved' })
          .eq('id', listingId)
          .eq('status', 'active');
      }
      return new Response('ok', { status: 200 });
    }

    // Otherwise: pattern PDF checkout (legacy/existing path).
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
    return new Response('ok', { status: 200 });
  }

  // ─────────────────────────────────────────────────────────────────
  // Connect account status changes
  // ─────────────────────────────────────────────────────────────────
  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account;
    const { error } = await supabase
      .from('knitter_profiles')
      .update({
        stripe_charges_enabled: !!account.charges_enabled,
        stripe_payouts_enabled: !!account.payouts_enabled,
      })
      .eq('stripe_account_id', account.id);
    if (error) console.error('Connect status update failed', error);
    return new Response('ok', { status: 200 });
  }

  // ─────────────────────────────────────────────────────────────────
  // Marketplace refund / dispute hooks
  // ─────────────────────────────────────────────────────────────────
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const piId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;
    if (piId) {
      await supabase
        .from('marketplace_orders')
        .update({ status: 'refunded', refunded_at: new Date().toISOString() })
        .eq('stripe_payment_intent_id', piId);
    }
    return new Response('ok', { status: 200 });
  }

  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as Stripe.Dispute;
    const piId = typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
    if (piId) {
      await supabase
        .from('marketplace_orders')
        .update({
          status: 'disputed',
          disputed_at: new Date().toISOString(),
          dispute_reason: dispute.reason ?? null,
        })
        .eq('stripe_payment_intent_id', piId);
    }
    return new Response('ok', { status: 200 });
  }

  return new Response('ok', { status: 200 });
};
