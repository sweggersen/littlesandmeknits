import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getEntry } from 'astro:content';
import { buildServiceContext } from '../../lib/services/context';
import { createPatternCheckout } from '../../lib/services/checkout';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const slug = formData.get('pattern')?.toString();
  if (!slug) return new Response('Missing pattern', { status: 400 });

  const pattern = await getEntry('patterns', slug);
  if (!pattern || pattern.data.draft) {
    return new Response('Pattern not found', { status: 404 });
  }

  const lang = (formData.get('lang')?.toString() === 'en' ? 'en' : 'nb') as 'nb' | 'en';

  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) {
    const patternPath = lang === 'nb' ? `/oppskrifter/${slug}` : `/en/oppskrifter/${slug}`;
    const loginPath = lang === 'nb' ? '/logg-inn' : '/en/login';
    return redirect(`${loginPath}?next=${encodeURIComponent(patternPath)}`);
  }

  const result = await createPatternCheckout(ctx, {
    slug,
    lang,
    title: pattern.data.title[lang],
    summary: pattern.data.summary[lang],
    priceNok: pattern.data.price,
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? '',
  });

  if (!result.ok) return new Response(result.message, { status: 500 });
  return redirect(result.data.checkoutUrl, 303);
};
