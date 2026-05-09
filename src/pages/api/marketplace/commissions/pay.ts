import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase, createAdminSupabase } from '../../../../lib/supabase';
import { createNotification } from '../../../../lib/notify';
import { createStripe } from '../../../../lib/stripe';

const PLATFORM_FEE_PERCENT = 13;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const env = import.meta.env;
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const form = await request.formData();
  const request_id = form.get('request_id')?.toString();
  if (!request_id) return new Response('Mangler forespørsel-ID', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  const { data: req } = await supabase
    .from('commission_requests')
    .select('id, buyer_id, status, awarded_offer_id, title, category, size_label, colorway, yarn_preference, pattern_external_title, yarn_provided_by_buyer')
    .eq('id', request_id)
    .single();

  if (!req || req.buyer_id !== user.id) {
    return new Response('Ikke din forespørsel', { status: 403 });
  }
  if (req.status !== 'awaiting_payment') {
    return new Response('Forespørselen venter ikke på betaling', { status: 400 });
  }

  const { data: offer } = await supabase
    .from('commission_offers')
    .select('id, knitter_id, price_nok')
    .eq('id', req.awarded_offer_id!)
    .single();

  if (!offer) {
    return new Response('Tilbud ikke funnet', { status: 404 });
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

  // Look up knitter's Stripe Connect account
  const { data: knitterProfile } = await admin
    .from('profiles')
    .select('stripe_account_id, stripe_onboarded')
    .eq('id', offer.knitter_id)
    .maybeSingle();

  const amountOre = offer.price_nok * 100;
  const platformFee = Math.round(amountOre * PLATFORM_FEE_PERCENT / 100);
  let paymentIntentId: string | undefined;

  if (knitterProfile?.stripe_onboarded && knitterProfile.stripe_account_id) {
    const stripe = createStripe(env.STRIPE_SECRET_KEY);
    const pi = await stripe.paymentIntents.create({
      amount: amountOre,
      currency: 'nok',
      capture_method: 'manual',
      application_fee_amount: platformFee,
      transfer_data: { destination: knitterProfile.stripe_account_id },
      metadata: { commission_request_id: request_id, buyer_id: user.id },
    });
    paymentIntentId = pi.id;

    // Confirm immediately (buyer has already agreed to pay)
    await stripe.paymentIntents.confirm(pi.id, {
      payment_method: 'pm_card_visa', // placeholder — real flow uses Stripe Elements on frontend
      return_url: `${env.PUBLIC_SITE_URL}/marked/oppdrag/${request_id}`,
    });
  }

  const needsYarn = req.yarn_provided_by_buyer;

  const { data: project } = await admin
    .from('projects')
    .insert({
      user_id: offer.knitter_id,
      title: req.title,
      target_size: req.size_label,
      yarn: req.yarn_preference ?? undefined,
      summary: [
        req.pattern_external_title ? `Oppskrift: ${req.pattern_external_title}` : null,
        req.colorway ? `Farge: ${req.colorway}` : null,
      ].filter(Boolean).join('\n') || null,
      status: needsYarn ? 'planning' : 'active',
      commission_offer_id: offer.id,
      started_at: needsYarn ? undefined : new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single();

  if (project) {
    await admin
      .from('commission_offers')
      .update({ project_id: project.id })
      .eq('id', offer.id);
  }

  await admin
    .from('commission_requests')
    .update({
      status: needsYarn ? 'awaiting_yarn' : 'awarded',
      stripe_payment_intent_id: paymentIntentId ?? null,
      platform_fee_nok: Math.round(platformFee / 100),
    })
    .eq('id', request_id);

  await createNotification(admin, {
    userId: offer.knitter_id,
    type: 'payment_received',
    title: 'Betaling mottatt!',
    body: needsYarn
      ? `Betaling for «${req.title}» er mottatt. Venter på at kjøper sender garnet.`
      : `Betaling for «${req.title}» er mottatt — du kan begynne å strikke!`,
    url: `/marked/oppdrag/${request_id}`,
    actorId: user.id,
    referenceId: request_id,
  }, env);

  return redirect(`/marked/oppdrag/${request_id}`, 303);
};
