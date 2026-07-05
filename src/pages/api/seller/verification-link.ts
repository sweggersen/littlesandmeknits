import type { APIRoute } from 'astro';
import { env } from '../../../lib/env';
import { buildServiceContext } from '../../../lib/services/context';
import { createSellerVerificationLink } from '../../../lib/services/stripe-connect';

// P0.4 remediation: send a seller whose Connect account needs more info to a
// Stripe-hosted Account Link to finish verification, then back to /profile.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/login?next=/profile', 302);

  const { data: seller } = await ctx.supabase
    .from('seller_profiles')
    .select('stripe_account_id')
    .eq('id', ctx.user.id)
    .maybeSingle();

  if (!seller?.stripe_account_id) {
    return redirect('/profile/become-seller?error=server_error', 302);
  }

  const site = ctx.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  const link = await createSellerVerificationLink(env.STRIPE_SECRET_KEY, seller.stripe_account_id, {
    // refresh_url: Stripe hits this if the link expires before use → re-mint.
    refreshUrl: `${site}/api/seller/verification-link`,
    returnUrl: `${site}/profile?verification=submitted`,
  });

  if (!link.ok) return redirect('/profile/become-seller?error=stripe_error', 302);
  return redirect(link.url, 303);
};
