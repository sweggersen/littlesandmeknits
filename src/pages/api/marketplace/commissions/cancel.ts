import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const form = await request.formData();
  const request_id = form.get('request_id')?.toString();
  if (!request_id) return new Response('Mangler forespørsel-ID', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  const { data: req } = await supabase
    .from('commission_requests')
    .select('id, buyer_id, status')
    .eq('id', request_id)
    .maybeSingle();

  if (!req || req.buyer_id !== user.id) {
    return new Response('Ikke din forespørsel', { status: 403 });
  }
  if (req.status !== 'open') {
    return new Response('Kan bare avbryte åpne forespørsler', { status: 400 });
  }

  await supabase
    .from('commission_requests')
    .update({ status: 'cancelled' })
    .eq('id', request_id);

  await supabase
    .from('commission_offers')
    .update({ status: 'declined' })
    .eq('request_id', request_id)
    .eq('status', 'pending');

  return redirect('/marked/oppdrag/mine', 303);
};
