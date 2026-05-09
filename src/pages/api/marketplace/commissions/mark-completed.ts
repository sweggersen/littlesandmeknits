import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase, createAdminSupabase } from '../../../../lib/supabase';
import { createNotification } from '../../../../lib/notify';

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
    .select('id, buyer_id, status, title, awarded_offer_id')
    .eq('id', request_id)
    .single();

  if (!req || req.status !== 'awarded') {
    return new Response('Oppdraget kan ikke merkes som ferdig nå', { status: 400 });
  }

  const { data: offer } = await supabase
    .from('commission_offers')
    .select('knitter_id')
    .eq('id', req.awarded_offer_id!)
    .single();

  if (!offer || offer.knitter_id !== user.id) {
    return new Response('Du er ikke strikker på dette oppdraget', { status: 403 });
  }

  const autoRelease = new Date();
  autoRelease.setDate(autoRelease.getDate() + 14);

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

  await admin
    .from('commission_requests')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      auto_release_at: autoRelease.toISOString(),
    })
    .eq('id', request_id);

  await createNotification(admin, {
    userId: req.buyer_id,
    type: 'commission_completed',
    title: 'Oppdraget er ferdig!',
    body: `Strikkeren har merket «${req.title}» som ferdig. Bekreft mottak innen 14 dager.`,
    url: `/marked/oppdrag/${request_id}`,
    actorId: user.id,
    referenceId: request_id,
  }, env);

  return redirect(`/marked/oppdrag/${request_id}`, 303);
};
