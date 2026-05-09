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

  const tracking_code = form.get('tracking_code')?.toString()?.trim() || null;

  const supabase = createServerSupabase({ request, cookies });

  const { data: req } = await supabase
    .from('commission_requests')
    .select('id, buyer_id, status, title, awarded_offer_id')
    .eq('id', request_id)
    .single();

  if (!req || req.buyer_id !== user.id) {
    return new Response('Ikke din forespørsel', { status: 403 });
  }
  if (req.status !== 'awaiting_yarn') {
    return new Response('Forespørselen venter ikke på garn', { status: 400 });
  }

  await supabase
    .from('commission_requests')
    .update({
      yarn_shipped_at: new Date().toISOString(),
      yarn_tracking_code: tracking_code,
    })
    .eq('id', request_id);

  const { data: offer } = await supabase
    .from('commission_offers')
    .select('knitter_id')
    .eq('id', req.awarded_offer_id!)
    .single();

  if (offer) {
    const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
    await createNotification(admin, {
      userId: offer.knitter_id,
      type: 'yarn_shipped',
      title: 'Garnet er sendt!',
      body: tracking_code ? `Sporingskode: ${tracking_code}` : `Kjøper har sendt garnet for «${req.title}»`,
      url: `/marked/oppdrag/${request_id}`,
      actorId: user.id,
      referenceId: request_id,
    }, env);
  }

  return redirect(`/marked/oppdrag/${request_id}`, 303);
};
