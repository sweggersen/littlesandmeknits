import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';
import { getTracking } from '../../../../lib/bring';

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const env = import.meta.env;
  const user = await getCurrentUser({ request, cookies });
  if (!user) return new Response('Unauthorized', { status: 401 });

  const requestId = url.searchParams.get('request_id');
  if (!requestId) return new Response('Missing request_id', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  const { data: req } = await supabase
    .from('commission_requests')
    .select('id, buyer_id, yarn_bring_shipment_number, awarded_offer_id')
    .eq('id', requestId)
    .maybeSingle();

  if (!req) return new Response('Not found', { status: 404 });

  const { data: offer } = await supabase
    .from('commission_offers')
    .select('knitter_id')
    .eq('id', req.awarded_offer_id!)
    .maybeSingle();

  if (req.buyer_id !== user.id && offer?.knitter_id !== user.id) {
    return new Response('Forbidden', { status: 403 });
  }

  if (!req.yarn_bring_shipment_number) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = { uid: env.BRING_API_UID, apiKey: env.BRING_API_KEY, customerNumber: env.BRING_CUSTOMER_NUMBER };
  const events = await getTracking(auth, req.yarn_bring_shipment_number);

  return new Response(JSON.stringify(events), {
    headers: { 'Content-Type': 'application/json' },
  });
};
