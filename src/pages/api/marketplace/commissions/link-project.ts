import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const form = await request.formData();
  const offer_id = form.get('offer_id')?.toString();
  const project_id = form.get('project_id')?.toString();
  if (!offer_id || !project_id) {
    return new Response('Mangler tilbud-ID eller prosjekt-ID', { status: 400 });
  }

  const supabase = createServerSupabase({ request, cookies });

  const { data: offer } = await supabase
    .from('commission_offers')
    .select('id, request_id, knitter_id, status')
    .eq('id', offer_id)
    .maybeSingle();

  if (!offer || offer.knitter_id !== user.id) {
    return new Response('Ikke ditt tilbud', { status: 403 });
  }
  if (offer.status !== 'accepted') {
    return new Response('Tilbudet er ikke akseptert', { status: 400 });
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id')
    .eq('id', project_id)
    .maybeSingle();

  if (!project || project.user_id !== user.id) {
    return new Response('Ikke ditt prosjekt', { status: 403 });
  }

  await supabase
    .from('commission_offers')
    .update({ project_id })
    .eq('id', offer_id);

  await supabase
    .from('projects')
    .update({ commission_offer_id: offer_id })
    .eq('id', project_id);

  return redirect(`/marked/oppdrag/${offer.request_id}`, 303);
};
