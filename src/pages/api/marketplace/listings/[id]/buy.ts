import type { APIRoute } from 'astro';
import { env } from '../../../../../lib/env';
import { buildServiceContext } from '../../../../../lib/services/context';
import { purchaseListing } from '../../../../../lib/services/listings';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/login');

  const result = await purchaseListing(ctx, {
    listingId: params.id ?? '',
    stripeSecretKey: env.STRIPE_SECRET_KEY,
  });
  // Full-page form: on failure (e.g. Stripe down) send the buyer back to the
  // listing with the message in the global error toast, not a bare error page.
  if (!result.ok) {
    return redirect(`/market/listing/${params.id ?? ''}?error=${encodeURIComponent(result.message)}`, 303);
  }
  return redirect(result.data.checkoutUrl, 303);
};
