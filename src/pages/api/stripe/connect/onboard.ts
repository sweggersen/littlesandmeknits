import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase, createAdminSupabase } from '../../../../lib/supabase';
import { createStripe } from '../../../../lib/stripe';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const env = import.meta.env;
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const stripe = createStripe(env.STRIPE_SECRET_KEY);
  const supabase = createServerSupabase({ request, cookies });

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_account_id')
    .eq('id', user.id)
    .maybeSingle();

  let accountId = profile?.stripe_account_id;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'NO',
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    accountId = account.id;

    const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
    await admin
      .from('profiles')
      .update({ stripe_account_id: accountId })
      .eq('id', user.id);
  }

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${env.PUBLIC_SITE_URL}/profil/rediger?stripe=refresh`,
    return_url: `${env.PUBLIC_SITE_URL}/api/stripe/connect/callback`,
    type: 'account_onboarding',
  });

  return redirect(accountLink.url, 303);
};
