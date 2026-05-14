import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { buildServiceContext } from '../../../../../lib/services/context';
import { purchaseListing } from '../../../../../lib/services/listings';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const result = await purchaseListing(ctx, {
    listingId: params.id ?? '',
    stripeSecretKey: env.STRIPE_SECRET_KEY,
  });
  if (!result.ok) return new Response(result.message, { status: 500 });
  return redirect(result.data.checkoutUrl, 303);
};
