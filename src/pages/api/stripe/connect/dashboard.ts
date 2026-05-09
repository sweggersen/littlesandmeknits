import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';
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
    return redirect('/profil/rediger');
  }

  const stripe = createStripe(env.STRIPE_SECRET_KEY);
  const loginLink = await stripe.accounts.createLoginLink(profile.stripe_account_id);

  return redirect(loginLink.url, 303);
};
