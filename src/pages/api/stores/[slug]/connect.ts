// POST /api/stores/:slug/connect
// Owner-only: create the store's Express Connect account (if needed) and hand
// the owner off to Stripe-hosted onboarding. Redirects straight to the Stripe
// Account Link so store-owned listings can receive payouts.
import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { getStoreBySlugAdmin } from '../../../../lib/services/stores';
import { startStoreOnboarding } from '../../../../lib/services/store-connect';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const store = await getStoreBySlugAdmin(ctx, params.slug ?? '');
  if (!store) return new Response('Not found', { status: 404 });

  const site = ctx.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  const adminUrl = `/market/store/${store.slug}/admin`;
  const result = await startStoreOnboarding(ctx, store.id, {
    // refresh_url: Stripe hits this if the link expires before use -> re-mint.
    refreshUrl: `${site}/api/stores/${store.slug}/connect`,
    returnUrl: `${site}${adminUrl}?payout=submitted`,
  });
  if (!result.ok) {
    const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
    if (isJson) return toResponse(result);
    return redirect(`${adminUrl}?payout=error`, 302);
  }
  return redirect(result.data.url, 303);
};
