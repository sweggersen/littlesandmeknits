import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { buildServiceContext } from '../../../../../lib/services/context';
import { upgradeListingEscrow } from '../../../../../lib/services/listings';
import { toResponse } from '../../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/login');

  const result = await upgradeListingEscrow(ctx, {
    listingId: params.id ?? '',
    stripeSecretKey: env.STRIPE_SECRET_KEY,
  });
  return toResponse(result, redirect);
};
