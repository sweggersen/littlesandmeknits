import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';
import { ensureConnectAccount, createOnboardingLink } from '../../../../lib/stripe-connect';

// POST /api/stripe/connect/onboard
// Creates (or reuses) a Stripe Connect Express account for the current
// user and redirects them to Stripe's hosted onboarding flow. Stripe
// returns them to /studio/marked/innstillinger?return=1 on success.

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn?next=/studio/marked/innstillinger');

  if (!env.STRIPE_SECRET_KEY) {
    return new Response('Stripe not configured', { status: 503 });
  }

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  const supabase = createServerSupabase({ request, cookies });

  // Read current knitter profile if any.
  const { data: existing } = await supabase
    .from('knitter_profiles')
    .select('user_id, stripe_account_id, slug')
    .eq('user_id', user.id)
    .maybeSingle();

  // Ensure (or create) a Stripe Connect account.
  const account = await ensureConnectAccount(env.STRIPE_SECRET_KEY, {
    existingId: existing?.stripe_account_id ?? null,
    email: user.email,
    userId: user.id,
  });

  // Upsert knitter_profiles row.
  if (!existing) {
    // Need a slug. Use a sanitized prefix of the email local-part with
    // a 4-char random suffix; collision retry handled by unique index.
    const local = (user.email ?? user.id).split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'strikker';
    const suffix = Math.random().toString(36).slice(2, 6);
    await supabase
      .from('knitter_profiles')
      .insert({
        user_id: user.id,
        slug: `${local}-${suffix}`,
        stripe_account_id: account.id,
        availability: 'closed',
      });
  } else if (existing.stripe_account_id !== account.id) {
    await supabase
      .from('knitter_profiles')
      .update({ stripe_account_id: account.id })
      .eq('user_id', user.id);
  }

  const url = await createOnboardingLink(env.STRIPE_SECRET_KEY, {
    accountId: account.id,
    siteUrl,
  });
  return redirect(url, 303);
};
