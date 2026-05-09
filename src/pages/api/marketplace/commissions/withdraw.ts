import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const form = await request.formData();
  const offer_id = form.get('offer_id')?.toString();
  if (!offer_id) return new Response('Mangler tilbud-ID', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  const { data: offer } = await supabase
    .from('commission_offers')
    .select('id, request_id, knitter_id, status')
    .eq('id', offer_id)
    .maybeSingle();

  if (!offer || offer.knitter_id !== user.id) {
    return new Response('Ikke ditt tilbud', { status: 403 });
  }
  if (offer.status !== 'pending') {
    return new Response('Kan bare trekke tilbake ventende tilbud', { status: 400 });
  }

  await supabase
    .from('commission_offers')
    .update({ status: 'withdrawn' })
    .eq('id', offer_id);

  return redirect(`/marked/oppdrag/${offer.request_id}`, 303);
};
