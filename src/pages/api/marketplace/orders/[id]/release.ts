import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCurrentUser } from '../../../../../lib/auth';
import { createAdminSupabase, createServerSupabase } from '../../../../../lib/supabase';
import { createStripe } from '../../../../../lib/stripe';

// POST /api/marketplace/orders/:id/release
// Buyer confirms receipt. Triggers the Stripe Transfer to the seller's
// connected account (separate-charges-and-transfers escrow model — see
// docs/marketplace/02-payments.md).

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');
  if (!env.STRIPE_SECRET_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Server not configured', { status: 503 });
  }
  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  // Buyer-only guard via RLS-respecting client.
  const supabase = createServerSupabase({ request, cookies });
  const { data: order } = await supabase
    .from('marketplace_orders')
    .select('id, buyer_id, seller_id, listing_id, status, net_to_seller_nok, currency, stripe_payment_intent_id')
    .eq('id', id)
    .maybeSingle();
  if (!order || order.buyer_id !== user.id) {
    return new Response('Not found', { status: 404 });
  }
  if (order.status !== 'shipped' && order.status !== 'delivered') {
    return new Response('Order not ready for release', { status: 409 });
  }

  // Look up seller's Connect account.
  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: knitter } = await admin
    .from('knitter_profiles')
    .select('stripe_account_id, stripe_payouts_enabled')
    .eq('user_id', order.seller_id)
    .maybeSingle();
  if (!knitter?.stripe_account_id) {
    console.error('Release: seller has no Connect account', { orderId: id });
    return new Response('Seller payout not configured', { status: 409 });
  }

  // Create a transfer for net_to_seller_nok. We deliberately don't
  // require payouts_enabled — a transfer to an account whose payouts
  // are paused still credits the seller's Stripe balance.
  const stripe = createStripe(env.STRIPE_SECRET_KEY);
  const transfer = await stripe.transfers.create({
    amount: order.net_to_seller_nok * 100,
    currency: (order.currency ?? 'NOK').toLowerCase(),
    destination: knitter.stripe_account_id,
    transfer_group: order.id,
    metadata: { marketplace_order_id: order.id },
  });

  const { error } = await admin
    .from('marketplace_orders')
    .update({
      status: 'released',
      released_at: new Date().toISOString(),
      stripe_transfer_id: transfer.id,
    })
    .eq('id', id);
  if (error) {
    console.error('Release update failed', error);
    return new Response('Could not release', { status: 500 });
  }

  // Mark the listing sold (if not already).
  if (order.listing_id) {
    await admin
      .from('listings')
      .update({ status: 'sold', sold_at: new Date().toISOString() })
      .eq('id', order.listing_id)
      .neq('status', 'sold');
  }

  return redirect(`/studio/kjop/marked/${id}?released=1`, 303);
};
