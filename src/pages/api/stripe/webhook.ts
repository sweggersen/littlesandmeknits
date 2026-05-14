import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { env } from 'cloudflare:workers';
import { createStripe } from '../../../lib/stripe';
import { createAdminSupabase } from '../../../lib/supabase';
import { createNotification } from '../../../lib/notify';

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
      const sellerId = session.metadata?.seller_id;

      // Check seller trust tier for auto-approve
      let autoApprove = false;
      if (sellerId) {
        const { data: seller } = await supabase
          .from('profiles')
          .select('trust_tier')
          .eq('id', sellerId)
          .maybeSingle();
        autoApprove = seller?.trust_tier === 'trusted';
      }

      const newStatus = autoApprove ? 'active' : 'pending_review';
      const { error } = await supabase
        .from('listings')
        .update({
          status: newStatus,
          published_at: autoApprove ? new Date().toISOString() : null,
          listing_fee_session_id: session.id,
          listing_fee_nok: session.amount_total ? Math.round(session.amount_total / 100) : 0,
        })
        .eq('id', listingId)
        .eq('status', 'draft');
      if (error) {
        console.error('Listing fee publish failed', error, { listingId });
        return new Response('DB error', { status: 500 });
      }

      if (!autoApprove && sellerId) {
        await supabase.from('moderation_queue').insert({
          item_type: 'listing',
          item_id: listingId,
          submitter_id: sellerId,
        });
      }

      return new Response('ok', { status: 200 });
    }

    // ── Listing promotion ─────────────────────────────────────
    if (session.metadata?.type === 'listing_promotion') {
      const promoListingId = session.metadata.listing_id;
      const sellerId = session.metadata.seller_id;
      const tier = session.metadata.tier;
      if (!promoListingId || !sellerId || !tier) {
        console.error('Promotion webhook missing metadata', session.metadata);
        return new Response('Missing metadata', { status: 400 });
      }

      const endsAt = new Date(Date.now() + 7 * 86400_000).toISOString();

      await supabase
        .from('listing_promotions')
        .update({
          status: 'active',
          ends_at: endsAt,
          stripe_payment_intent_id: typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
        })
        .eq('stripe_session_id', session.id);

      await supabase
        .from('listings')
        .update({ promoted_until: endsAt, promotion_tier: tier })
        .eq('id', promoListingId);

      return new Response('ok', { status: 200 });
    }

    // ── Listing purchase (escrow via manual capture) ────────────
    if (session.metadata?.type === 'listing_purchase') {
      const purchaseListingId = session.metadata.listing_id;
      const buyerId = session.metadata.buyer_id;
      if (!purchaseListingId || !buyerId) {
        console.error('Listing purchase webhook missing metadata', session.metadata);
        return new Response('Missing metadata', { status: 400 });
      }

      const piId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

      const autoReleaseAt = new Date(Date.now() + 14 * 86400_000).toISOString();
      const now = new Date().toISOString();
      const feeNok = session.amount_total ? Math.round((session.amount_total * 0.13) / 100) : 0;

      const { error } = await supabase
        .from('listings')
        .update({
          status: 'reserved',
          buyer_id: buyerId,
          stripe_payment_intent_id: piId ?? null,
          platform_fee_nok: feeNok,
          reserved_at: now,
          auto_release_at: autoReleaseAt,
        })
        .eq('id', purchaseListingId)
        .eq('status', 'active');

      if (error) {
        console.error('Listing purchase update failed', error, { purchaseListingId });
        return new Response('DB error', { status: 500 });
      }

      const { data: listingData } = await supabase
        .from('listings')
        .select('seller_id, title')
        .eq('id', purchaseListingId)
        .maybeSingle();

      if (listingData) {
        await createNotification(supabase, {
          userId: listingData.seller_id,
          type: 'listing_purchased',
          title: 'Varen din er solgt!',
          body: `Noen har kjøpt «${listingData.title}». Send varen og legg inn sporingskode.`,
          url: `/marked/listing/${purchaseListingId}`,
          actorId: buyerId,
          referenceId: purchaseListingId,
        }, { RESEND_API_KEY: env.RESEND_API_KEY, PUBLIC_SITE_URL: env.PUBLIC_SITE_URL, PUBLIC_VAPID_KEY: env.PUBLIC_VAPID_KEY, VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY });
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

  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account;
    if (account.charges_enabled && account.payouts_enabled) {
      const supabase = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
      await supabase
        .from('profiles')
        .update({ stripe_onboarded: true })
        .eq('stripe_account_id', account.id);
    }
  }

  return new Response('ok', { status: 200 });
};
