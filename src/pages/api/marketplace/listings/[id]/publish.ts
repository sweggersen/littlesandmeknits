import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCurrentUser } from '../../../../../lib/auth';
import { createServerSupabase } from '../../../../../lib/supabase';
import { createStripe } from '../../../../../lib/stripe';

// POST /api/marketplace/listings/:id/publish
// Creates a Stripe Checkout session for the listing fee (29 NOK).
// On successful payment, the webhook flips status from draft → active.

const LISTING_FEE_NOK = 29;

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');
  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  if (!env.STRIPE_SECRET_KEY) return new Response('Stripe not configured', { status: 503 });

  const supabase = createServerSupabase({ request, cookies });
  const { data: listing } = await supabase
    .from('listings')
    .select('id, seller_id, title, status')
    .eq('id', id)
    .maybeSingle();

  if (!listing || listing.seller_id !== user.id) {
    return new Response('Not found', { status: 404 });
  }
  if (listing.status !== 'draft') {
    return redirect(`/marked/listing/${id}`, 303);
  }

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  const stripe = createStripe(env.STRIPE_SECRET_KEY);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'nok',
          unit_amount: LISTING_FEE_NOK * 100,
          product_data: { name: `Annonsegebyr: ${listing.title}` },
        },
        quantity: 1,
      },
    ],
    success_url: `${siteUrl}/marked/listing/${id}?published=1`,
    cancel_url: `${siteUrl}/marked/listing/${id}`,
    customer_email: user.email ?? undefined,
    client_reference_id: user.id,
    metadata: {
      type: 'listing_fee',
      listing_id: id,
      user_id: user.id,
    },
    locale: 'nb',
  });

  if (!session.url) return new Response('Checkout URL missing', { status: 500 });
  return redirect(session.url, 303);
};
