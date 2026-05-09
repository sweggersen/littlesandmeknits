import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase, createAdminSupabase } from '../../../../lib/supabase';
import { createStripe } from '../../../../lib/stripe';

export const GET: APIRoute = async ({ request, cookies, redirect }) => {
  const env = import.meta.env;
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const supabase = createServerSupabase({ request, cookies });
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_account_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.stripe_account_id) {
    return redirect('/profil/rediger?stripe=error');
  }

  const stripe = createStripe(env.STRIPE_SECRET_KEY);
  const account = await stripe.accounts.retrieve(profile.stripe_account_id);

  if (account.charges_enabled && account.payouts_enabled) {
    const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
    await admin
      .from('profiles')
      .update({ stripe_onboarded: true })
      .eq('id', user.id);
  }

  return redirect('/profil/rediger?stripe=success');
};
