import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase, createAdminSupabase } from '../../../../lib/supabase';
import { createStripe } from '../../../../lib/stripe';
import { calculatePlatformFee } from '../../../../lib/stripe-connect';

// POST /api/marketplace/orders/create
// Buyer-initiated. Creates a marketplace_orders row in pending_payment,
// then creates a Stripe Checkout session on the platform account. The
// webhook flips it to 'paid' on checkout.session.completed. Funds sit
// on the platform balance until the order is released to the seller.
//
// Form fields:
//   listing_id (required)

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  const form = await request.formData();
  const listingId = form.get('listing_id')?.toString();
  if (!listingId) return new Response('Missing listing', { status: 400 });

  if (!user) return redirect(`/logg-inn?next=${encodeURIComponent(`/marked/listing/${listingId}`)}`);

  if (!env.STRIPE_SECRET_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Server not configured', { status: 503 });
  }

  const supabase = createServerSupabase({ request, cookies });
  const { data: listing, error: listingErr } = await supabase
    .from('listings')
    .select('id, seller_id, kind, title, price_nok, status, hero_photo_path, shipping_options')
    .eq('id', listingId)
    .single();

  if (listingErr || !listing) {
    return new Response('Listing not found', { status: 404 });
  }
  if (listing.status !== 'active') {
    return new Response('Listing not available', { status: 409 });
  }
  if (listing.seller_id === user.id) {
    return new Response('Cannot buy own listing', { status: 400 });
  }
  if (listing.kind === 'commission') {
    return new Response('Commissions use a different flow', { status: 400 });
  }

  // Pick the cheapest shipping option for now. Buyer-side shipping
  // selection UI is future work.
  const shippingOpts = (listing.shipping_options ?? []) as Array<{ price_nok: number }>;
  const shipping_nok = shippingOpts.length
    ? Math.min(...shippingOpts.map((o) => o.price_nok))
    : 0;

  const gross_nok = listing.price_nok + shipping_nok;
  const platform_fee_nok = calculatePlatformFee({
    kind: listing.kind as 'pre_loved' | 'ready_made',
    gross_nok: listing.price_nok, // fee on item, not shipping
  });
  const net_to_seller_nok = gross_nok - platform_fee_nok;

  // Create the order row first (pending_payment) using service role —
  // matches how purchases are mutated.
  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: order, error: orderErr } = await admin
    .from('marketplace_orders')
    .insert({
      kind: listing.kind,
      buyer_id: user.id,
      seller_id: listing.seller_id,
      listing_id: listing.id,
      gross_nok,
      shipping_nok,
      platform_fee_nok,
      net_to_seller_nok,
      status: 'pending_payment',
    })
    .select('id')
    .single();

  if (orderErr || !order) {
    console.error('Order create failed', orderErr);
    return new Response('Could not create order', { status: 500 });
  }

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  const stripe = createStripe(env.STRIPE_SECRET_KEY);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'nok',
          unit_amount: listing.price_nok * 100,
          product_data: {
            name: listing.title,
            metadata: { listing_id: listing.id },
          },
        },
        quantity: 1,
      },
      ...(shipping_nok > 0
        ? [{
            price_data: {
              currency: 'nok',
              unit_amount: shipping_nok * 100,
              product_data: { name: 'Frakt' },
            },
            quantity: 1,
          }]
        : []),
    ],
    shipping_address_collection: { allowed_countries: ['NO'] },
    success_url: `${siteUrl}/studio/kjop/marked/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/marked/listing/${listing.id}`,
    customer_email: user.email ?? undefined,
    client_reference_id: user.id,
    metadata: {
      marketplace_order_id: order.id,
      listing_id: listing.id,
      buyer_id: user.id,
      seller_id: listing.seller_id,
    },
    locale: 'nb',
  });

  if (!session.url) return new Response('Checkout URL missing', { status: 500 });
  return redirect(session.url, 303);
};
