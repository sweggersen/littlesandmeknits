import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase, createAdminSupabase } from '../../../../lib/supabase';
import { createNotification } from '../../../../lib/notify';
import { createStripe } from '../../../../lib/stripe';

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
    .select('id, buyer_id, status, title, awarded_offer_id, stripe_payment_intent_id')
    .eq('id', request_id)
    .single();

  if (!req || req.buyer_id !== user.id) {
    return new Response('Ikke din forespørsel', { status: 403 });
  }
  if (req.status !== 'completed') {
    return new Response('Oppdraget er ikke merket som ferdig ennå', { status: 400 });
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

  if (req.stripe_payment_intent_id) {
    const stripe = createStripe(env.STRIPE_SECRET_KEY);
    await stripe.paymentIntents.capture(req.stripe_payment_intent_id);
  }

  await admin
    .from('commission_requests')
    .update({
      status: 'delivered',
      delivered_at: new Date().toISOString(),
    })
    .eq('id', request_id);

  const { data: offer } = await supabase
    .from('commission_offers')
    .select('knitter_id')
    .eq('id', req.awarded_offer_id!)
    .single();

  if (offer) {
    await createNotification(admin, {
      userId: offer.knitter_id,
      type: 'commission_delivered',
      title: 'Levering bekreftet!',
      body: `Kjøper har bekreftet mottak av «${req.title}». Takk for flott arbeid!`,
      url: `/marked/oppdrag/${request_id}`,
      actorId: user.id,
      referenceId: request_id,
    }, env);
  }

  return redirect(`/marked/oppdrag/${request_id}`, 303);
};
