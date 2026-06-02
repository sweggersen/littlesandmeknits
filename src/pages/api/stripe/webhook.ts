import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { env } from '../../../lib/env';
import { createStripe } from '../../../lib/stripe';
import { createAdminSupabase, type TypedSupabaseClient } from '../../../lib/supabase';
import { createNotification } from '../../../lib/notify';
import { recordDeadLetter } from '../../../lib/services/dead-letter';
import { log } from '../../../lib/log';

/** Minimal context for recordDeadLetter from inside the Stripe
 *  webhook. The webhook has no user session, so the actor (if any)
 *  comes from Stripe event metadata (buyer_id / seller_id / etc.). */
function dlCtx(admin: TypedSupabaseClient, userId?: string | null) {
  return {
    admin,
    user: userId ? { id: userId } : undefined,
  };
}

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
    log.error('webhook.signature_verification_failed', { error: err });
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
        await recordDeadLetter(dlCtx(supabase, sellerId), {
          service: 'stripe.webhook:listing_fee',
          context: { listing_id: listingId, session_id: session.id, seller_id: sellerId, auto_approve: autoApprove },
          error,
        });
        // 500 so Stripe retries — but the audit row is already written.
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

    // ── Escrow upgrade fee ──────────────────────────────────
    if (listingId && session.metadata?.type === 'escrow_upgrade') {
      const { error } = await supabase
        .from('listings')
        .update({
          escrow_enabled: true,
          escrow_fee_paid_at: new Date().toISOString(),
          escrow_fee_session_id: session.id,
          listing_fee_nok: session.amount_total ? Math.round(session.amount_total / 100) : 0,
        })
        .eq('id', listingId);
      if (error) {
        await recordDeadLetter(dlCtx(supabase, session.metadata?.seller_id), {
          service: 'stripe.webhook:escrow_upgrade',
          context: { listing_id: listingId, session_id: session.id },
          error,
        });
        return new Response('DB error', { status: 500 });
      }
      return new Response('ok', { status: 200 });
    }

    // ── Listing promotion ─────────────────────────────────────
    if (session.metadata?.type === 'listing_promotion') {
      const promoListingId = session.metadata.listing_id;
      const sellerId = session.metadata.seller_id;
      const tier = session.metadata.tier;
      if (!promoListingId || !sellerId || !tier) {
        log.error('webhook.promotion_missing_metadata', { metadata: session.metadata });
        return new Response('Missing metadata', { status: 400 });
      }

      const startsAtIso = new Date().toISOString();
      const endsAt = new Date(Date.now() + 7 * 86400_000).toISOString();

      const { error: promoErr } = await supabase
        .from('listing_promotions')
        .update({
          status: 'active',
          starts_at: startsAtIso,
          ends_at: endsAt,
          daily_window_start: startsAtIso,
          stripe_payment_intent_id: typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
        })
        .eq('stripe_session_id', session.id);

      if (promoErr) {
        await recordDeadLetter(dlCtx(supabase, sellerId), {
          service: 'stripe.webhook:promotion_activate',
          context: { listing_id: promoListingId, session_id: session.id, tier },
          error: promoErr,
        });
        return new Response('DB error', { status: 500 });
      }

      const { error: listingErr } = await supabase
        .from('listings')
        .update({ promoted_until: endsAt, promotion_tier: tier, promoted_at: startsAtIso })
        .eq('id', promoListingId);

      if (listingErr) {
        // Promotion row already marked active; listing row failed.
        // This is the classic "partial commit" case — record and let
        // Stripe retry. Idempotent updates make the retry safe.
        await recordDeadLetter(dlCtx(supabase, sellerId), {
          service: 'stripe.webhook:promotion_listing_mark',
          context: { listing_id: promoListingId, session_id: session.id, tier },
          error: listingErr,
        });
        return new Response('DB error', { status: 500 });
      }

      return new Response('ok', { status: 200 });
    }

    // ── Listing purchase (escrow via manual capture) ────────────
    if (session.metadata?.type === 'listing_purchase') {
      const purchaseListingId = session.metadata.listing_id;
      const buyerId = session.metadata.buyer_id;
      if (!purchaseListingId || !buyerId) {
        log.error('webhook.purchase_missing_metadata', { metadata: session.metadata });
        return new Response('Missing metadata', { status: 400 });
      }

      const piId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

      // Fallback deadline if the seller never ships (or doesn't mark
      // shipped). On `shipListing` we recompute this to shipped_at + 14d.
      const autoReleaseAt = new Date(Date.now() + 21 * 86400_000).toISOString();
      const now = new Date().toISOString();
      const feeNok = session.amount_total ? Math.round((session.amount_total * 0.13) / 100) : 0;

      // Stripe's TS types lag on Checkout Session shipping_details
      // (the field is present in API responses for sessions created
      // with shipping_address_collection enabled).
      const shipping = (session as unknown as { shipping_details?: { name?: string | null; address?: { line1?: string | null; postal_code?: string | null; city?: string | null } | null } }).shipping_details;
      const { error } = await supabase
        .from('listings')
        .update({
          status: 'reserved',
          buyer_id: buyerId,
          stripe_payment_intent_id: piId ?? null,
          platform_fee_nok: feeNok,
          reserved_at: now,
          auto_release_at: autoReleaseAt,
          buyer_name: shipping?.name ?? null,
          buyer_address: shipping?.address?.line1 ?? null,
          buyer_postal_code: shipping?.address?.postal_code ?? null,
          buyer_city: shipping?.address?.city ?? null,
        })
        .eq('id', purchaseListingId)
        .eq('status', 'active');

      if (error) {
        await recordDeadLetter(dlCtx(supabase, buyerId), {
          service: 'stripe.webhook:listing_purchase',
          context: {
            listing_id: purchaseListingId,
            session_id: session.id,
            buyer_id: buyerId,
            payment_intent_id: piId ?? null,
          },
          error,
        });
        // CRITICAL: buyer has paid. Stripe will retry; if final retry
        // fails, the dead-letter row tells support which listing is
        // stuck in 'active' with a paid PaymentIntent.
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
          url: `/market/listing/${purchaseListingId}`,
          actorId: buyerId,
          referenceId: purchaseListingId,
        }, {
          RESEND_API_KEY: env.RESEND_API_KEY,
          PUBLIC_SITE_URL: import.meta.env.PUBLIC_SITE_URL,
          PUBLIC_VAPID_KEY: import.meta.env.PUBLIC_VAPID_KEY,
          VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
        });
      }

      return new Response('ok', { status: 200 });
    }

    // ── Pattern PDF checkout (existing flow) ─────────────────────
    const userId = session.client_reference_id ?? session.metadata?.user_id;
    const slug = session.metadata?.pattern_slug;
    if (!userId || !slug) {
      log.error('webhook.pattern_missing_metadata', { userId, slug, sessionId: session.id });
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
      await recordDeadLetter(dlCtx(supabase, userId), {
        service: 'stripe.webhook:pattern_purchase',
        context: { user_id: userId, pattern_slug: slug, session_id: session.id },
        error,
      });
      return new Response('DB error', { status: 500 });
    }
  }

  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account;
    const { statusFromAccount } = await import('../../../lib/services/stripe-connect');
    const status = statusFromAccount(account);
    const supabase = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
    const update: {
      stripe_connect_status: string;
      stripe_connect_requirements: Stripe.Account.Requirements | null;
      seller_verified_at?: string;
    } = {
      stripe_connect_status: status,
      stripe_connect_requirements: account.requirements ?? null,
    };
    if (status === 'verified') {
      update.seller_verified_at = new Date().toISOString();
    }
    const { error: connectErr } = await supabase
      .from('seller_profiles')
      .update(update as never)
      .eq('stripe_account_id', account.id);
    if (connectErr) {
      await recordDeadLetter(dlCtx(supabase), {
        service: 'stripe.webhook:account_updated',
        context: { stripe_account_id: account.id, new_status: status },
        error: connectErr,
      });
      return new Response('DB error', { status: 500 });
    }
  }

  return new Response('ok', { status: 200 });
};
