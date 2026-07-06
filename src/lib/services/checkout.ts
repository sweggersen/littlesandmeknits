import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createStripe } from '../stripe';
import { SIMULATE_STRIPE_KEY } from '../stripe-sim';
import { killGuard } from '../flags';
import { assertWithinQuota } from './quota';

export async function createPatternCheckout(
  ctx: ServiceContext,
  input: {
    slug: string;
    lang: 'nb' | 'en';
    title: string;
    summary: string;
    priceNok: number;
    stripeSecretKey: string;
  },
): Promise<ServiceResult<{ checkoutUrl: string }>> {
  if (!input.slug) return fail('bad_input', 'Missing pattern');
  if (!input.stripeSecretKey) return fail('server_error', 'Stripe not configured');
  const blocked = await killGuard(['purchases'], ctx.env);
  if (blocked) return blocked;
  // Daily quota — each call creates a Stripe Checkout Session (API cost); cap
  // session-creation spam from an authenticated account.
  const quotaFail = await assertWithinQuota(ctx, 'pattern_checkout');
  if (quotaFail) return quotaFail;

  const siteUrl = ctx.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  const patternPath = input.lang === 'nb' ? `/patterns/${input.slug}` : `/en/patterns/${input.slug}`;

  // Dev only (sk_simulate): there is no real Stripe checkout and no webhook fires
  // locally, so grant the pattern immediately and land on the success page —
  // lets localhost exercise the buy → owned-pattern flow. createStripe() throws
  // if this key ever reaches a prod build, so this branch can't run in prod.
  if (input.stripeSecretKey === SIMULATE_STRIPE_KEY) {
    await ctx.admin.from('purchases').upsert({
      user_id: ctx.user.id,
      pattern_slug: input.slug,
      stripe_session_id: `sim_${input.slug}_${ctx.user.id}`,
      amount_nok: input.priceNok,
      currency: 'NOK',
      status: 'completed',
      pdf_path: `${input.slug}/v1.pdf`,
      fulfilled_at: new Date().toISOString(),
    }, { onConflict: 'stripe_session_id' });
    return ok({ checkoutUrl: `${siteUrl}/profile/purchases?simulated=1` });
  }

  const stripe = createStripe(input.stripeSecretKey);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'nok',
        unit_amount: input.priceNok * 100,
        product_data: {
          name: input.title,
          description: input.summary.slice(0, 500),
          metadata: { pattern_slug: input.slug },
        },
      },
      quantity: 1,
    }],
    success_url: `${siteUrl}/profile/purchases?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}${patternPath}`,
    customer_email: ctx.user.email ?? undefined,
    client_reference_id: ctx.user.id,
    metadata: { pattern_slug: input.slug, user_id: ctx.user.id, lang: input.lang },
    locale: input.lang === 'nb' ? 'nb' : 'en',
  });

  if (!session.url) return fail('server_error', 'Checkout URL missing');
  return ok({ checkoutUrl: session.url });
}

export async function getDownloadUrl(
  ctx: ServiceContext,
  input: { purchaseId: string },
): Promise<ServiceResult<{ signedUrl: string }>> {
  if (!input.purchaseId) return fail('bad_input', 'Missing id');

  const { data: purchase, error } = await ctx.supabase
    .from('purchases')
    .select('id, pdf_path, status, user_id')
    .eq('id', input.purchaseId)
    .eq('status', 'completed')
    .maybeSingle();

  if (error || !purchase || !purchase.pdf_path) return fail('not_found', 'Not found');
  if (purchase.user_id !== ctx.user.id) return fail('forbidden', 'Forbidden');

  const { data: signed, error: signErr } = await ctx.admin.storage
    .from('patterns')
    .createSignedUrl(purchase.pdf_path, 60);

  if (signErr || !signed?.signedUrl) {
    console.error('Signed URL failed', signErr);
    return fail('server_error', 'Could not generate download');
  }

  return ok({ signedUrl: signed.signedUrl });
}
