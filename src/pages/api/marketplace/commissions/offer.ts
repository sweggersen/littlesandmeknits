import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase, createAdminSupabase } from '../../../../lib/supabase';
import { createNotification } from '../../../../lib/notify';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const form = await request.formData();
  const request_id = form.get('request_id')?.toString();
  if (!request_id) return new Response('Mangler forespørsel-ID', { status: 400 });

  const price_nok = parseInt(form.get('price_nok')?.toString() ?? '', 10);
  if (!Number.isFinite(price_nok) || price_nok <= 0) {
    return new Response('Ugyldig pris', { status: 400 });
  }

  const turnaround_weeks = parseInt(form.get('turnaround_weeks')?.toString() ?? '', 10);
  if (!Number.isFinite(turnaround_weeks) || turnaround_weeks <= 0) {
    return new Response('Ugyldig leveringstid', { status: 400 });
  }

  const message = form.get('message')?.toString().trim() ?? '';
  if (!message) return new Response('Melding er påkrevd', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  const { data: req } = await supabase
    .from('commission_requests')
    .select('id, buyer_id, status, title')
    .eq('id', request_id)
    .maybeSingle();

  if (!req || req.status !== 'open') {
    return new Response('Forespørselen er ikke åpen', { status: 400 });
  }
  if (req.buyer_id === user.id) {
    return new Response('Du kan ikke by på din egen forespørsel', { status: 400 });
  }

  const { error } = await supabase
    .from('commission_offers')
    .insert({
      request_id,
      knitter_id: user.id,
      price_nok,
      turnaround_weeks,
      message,
    });

  if (error) {
    if (error.code === '23505') {
      return new Response('Du har allerede sendt et tilbud', { status: 400 });
    }
    console.error('Offer create failed', error);
    return new Response('Kunne ikke sende tilbud', { status: 500 });
  }

  const env = import.meta.env;
  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  await createNotification(admin, {
    userId: req.buyer_id,
    type: 'new_offer',
    title: 'Nytt tilbud!',
    body: `Noen har gitt tilbud på «${req.title}» — ${price_nok} kr, ${turnaround_weeks} uker.`,
    url: `/marked/oppdrag/${request_id}`,
    actorId: user.id,
    referenceId: request_id,
  }, env);

  return redirect(`/marked/oppdrag/${request_id}`, 303);
};
