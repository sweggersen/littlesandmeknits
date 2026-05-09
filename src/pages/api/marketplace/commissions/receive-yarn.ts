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
    .select('id, buyer_id, status, title, awarded_offer_id, yarn_shipped_at')
    .eq('id', request_id)
    .single();

  if (!req || req.status !== 'awaiting_yarn' || !req.yarn_shipped_at) {
    return new Response('Garnet er ikke merket som sendt ennå', { status: 400 });
  }

  const { data: offer } = await supabase
    .from('commission_offers')
    .select('id, knitter_id, project_id')
    .eq('id', req.awarded_offer_id!)
    .single();

  if (!offer || offer.knitter_id !== user.id) {
    return new Response('Du er ikke strikker på dette oppdraget', { status: 403 });
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

  await admin
    .from('commission_requests')
    .update({
      status: 'awarded',
      yarn_received_at: new Date().toISOString(),
    })
    .eq('id', request_id);

  if (offer.project_id) {
    await admin
      .from('projects')
      .update({ status: 'active' })
      .eq('id', offer.project_id);
  }

  await createNotification(admin, {
    userId: req.buyer_id,
    type: 'yarn_received',
    title: 'Garnet er mottatt!',
    body: `Strikkeren har mottatt garnet for «${req.title}» og kan begynne.`,
    url: `/marked/oppdrag/${request_id}`,
    actorId: user.id,
    referenceId: request_id,
  }, env);

  return redirect(`/marked/oppdrag/${request_id}`, 303);
};
