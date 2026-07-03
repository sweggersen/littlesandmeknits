import type { APIRoute } from 'astro';
import { env } from '../../../../../lib/env';
import { requireCtx, jsonResult } from '../../../../../lib/api/v1';
import { purchaseListing } from '../../../../../lib/services/listings';

// POST /api/v1/listings/:id/buy — start an escrow purchase. Returns
// { checkoutUrl } as JSON; the client opens it (in-app browser / Custom Tab).
// The escrow capture/transfer stays entirely server-side in purchaseListing —
// the client never touches a Stripe secret.
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const ctx = await requireCtx(request, cookies);
  if (ctx instanceof Response) return ctx;

  const result = await purchaseListing(ctx, {
    listingId: params.id ?? '',
    stripeSecretKey: env.STRIPE_SECRET_KEY,
  });
  return jsonResult(result);
};
