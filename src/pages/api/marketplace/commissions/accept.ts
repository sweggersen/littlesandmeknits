import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase, createAdminSupabase } from '../../../../lib/supabase';
import { createNotification } from '../../../../lib/notify';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const form = await request.formData();
  const offer_id = form.get('offer_id')?.toString();
  if (!offer_id) return new Response('Mangler tilbud-ID', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  const { data: offer } = await supabase
    .from('commission_offers')
    .select('id, request_id, status, knitter_id')
    .eq('id', offer_id)
    .maybeSingle();

  if (!offer) return new Response('Tilbud ikke funnet', { status: 404 });

  const { data: req } = await supabase
    .from('commission_requests')
    .select('id, buyer_id, status, title')
    .eq('id', offer.request_id)
    .single();

  if (!req || req.buyer_id !== user.id) {
    return new Response('Ikke din forespørsel', { status: 403 });
  }
  if (req.status !== 'open' || offer.status !== 'pending') {
    return new Response('Kan ikke akseptere dette tilbudet', { status: 400 });
  }

  // Accept this offer
  await supabase
    .from('commission_offers')
    .update({ status: 'accepted' })
    .eq('id', offer_id);

  // Move request to awaiting_payment (buyer must pay before knitter starts)
  await supabase
    .from('commission_requests')
    .update({ status: 'awaiting_payment', awarded_offer_id: offer_id })
    .eq('id', offer.request_id);

  // Decline all other pending offers
  const { data: declined } = await supabase
    .from('commission_offers')
    .update({ status: 'declined' })
    .eq('request_id', offer.request_id)
    .eq('status', 'pending')
    .neq('id', offer_id)
    .select('knitter_id');

  const env = import.meta.env;
  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

  await createNotification(admin, {
    userId: offer.knitter_id,
    type: 'offer_accepted',
    title: 'Tilbudet ditt er akseptert!',
    body: `Kjøper valgte tilbudet ditt på «${req.title}». Venter nå på betaling.`,
    url: `/marked/oppdrag/${offer.request_id}`,
    actorId: user.id,
    referenceId: offer.request_id,
  }, env);

  if (declined?.length) {
    await Promise.all(
      declined.map((d) =>
        createNotification(admin, {
          userId: d.knitter_id,
          type: 'offer_declined',
          title: 'Tilbudet ble ikke valgt',
          body: `Kjøper valgte et annet tilbud på «${req.title}».`,
          url: `/marked/oppdrag/${offer.request_id}`,
          actorId: user.id,
          referenceId: offer.request_id,
        }, env),
      ),
    );
  }

  return redirect(`/marked/oppdrag/${offer.request_id}`, 303);
};
