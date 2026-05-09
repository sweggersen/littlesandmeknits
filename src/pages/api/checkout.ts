import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getEntry } from 'astro:content';
import { getCurrentUser } from '../../lib/auth';
import { createStripe } from '../../lib/stripe';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const slug = formData.get('pattern')?.toString();
  if (!slug) return new Response('Missing pattern', { status: 400 });

  const pattern = await getEntry('patterns', slug);
  if (!pattern || pattern.data.draft) {
    return new Response('Pattern not found', { status: 404 });
  }

  const lang = (formData.get('lang')?.toString() === 'en' ? 'en' : 'nb') as 'nb' | 'en';
  const patternPath = lang === 'nb' ? `/oppskrifter/${slug}` : `/en/oppskrifter/${slug}`;

  const user = await getCurrentUser({ request, cookies });
  if (!user) {
    const loginPath = lang === 'nb' ? '/logg-inn' : '/en/login';
    return redirect(`${loginPath}?next=${encodeURIComponent(patternPath)}`);
  }

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  if (!env.STRIPE_SECRET_KEY) {
    return new Response('Stripe not configured', { status: 503 });
  }

  const stripe = createStripe(env.STRIPE_SECRET_KEY);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'nok',
          unit_amount: pattern.data.price * 100,
          product_data: {
            name: pattern.data.title[lang],
            description: pattern.data.summary[lang].slice(0, 500),
            metadata: { pattern_slug: slug },
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${siteUrl}/profil/kjop?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}${patternPath}`,
    customer_email: user.email ?? undefined,
    client_reference_id: user.id,
    metadata: {
      pattern_slug: slug,
      user_id: user.id,
      lang,
    },
    locale: lang === 'nb' ? 'nb' : 'en',
  });

  if (!session.url) {
    return new Response('Checkout URL missing', { status: 500 });
  }
  return redirect(session.url, 303);
};
