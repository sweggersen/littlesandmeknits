import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createStripe } from '../stripe';

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

  const siteUrl = ctx.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  const patternPath = input.lang === 'nb' ? `/oppskrifter/${input.slug}` : `/en/oppskrifter/${input.slug}`;

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
    success_url: `${siteUrl}/profil/kjop?session_id={CHECKOUT_SESSION_ID}`,
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
