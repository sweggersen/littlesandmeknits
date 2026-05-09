import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase, createAdminSupabase } from '../../../../lib/supabase';
import { bookShipment } from '../../../../lib/bring';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const env = import.meta.env;
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const form = await request.formData();
  const request_id = form.get('request_id')?.toString();
  if (!request_id) return new Response('Mangler forespørsel-ID', { status: 400 });

  const fromName = form.get('from_name')?.toString()?.trim();
  const fromAddress = form.get('from_address')?.toString()?.trim();
  const fromPostal = form.get('from_postal')?.toString()?.trim();
  const fromCity = form.get('from_city')?.toString()?.trim();
  const toName = form.get('to_name')?.toString()?.trim();
  const toAddress = form.get('to_address')?.toString()?.trim();
  const toPostal = form.get('to_postal')?.toString()?.trim();
  const toCity = form.get('to_city')?.toString()?.trim();

  if (!fromName || !fromAddress || !fromPostal || !fromCity || !toName || !toAddress || !toPostal || !toCity) {
    return new Response('Alle adressefelt er påkrevd', { status: 400 });
  }

  const supabase = createServerSupabase({ request, cookies });

  const { data: req } = await supabase
    .from('commission_requests')
    .select('id, buyer_id, status, yarn_shipped_at')
    .eq('id', request_id)
    .single();

  if (!req || req.buyer_id !== user.id) {
    return new Response('Ikke din forespørsel', { status: 403 });
  }
  if (req.status !== 'awaiting_yarn') {
    return new Response('Forespørselen venter ikke på garn', { status: 400 });
  }

  const auth = { uid: env.BRING_API_UID, apiKey: env.BRING_API_KEY, customerNumber: env.BRING_CUSTOMER_NUMBER };
  const result = await bookShipment(auth, {
    fromName, fromAddress, fromPostal, fromCity,
    toName, toAddress, toPostal, toCity,
    weightGrams: 500,
  });

  if (!result) {
    return new Response('Kunne ikke booke forsendelse. Prøv igjen senere.', { status: 500 });
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  await admin
    .from('commission_requests')
    .update({
      yarn_shipped_at: new Date().toISOString(),
      yarn_tracking_code: result.shipmentNumber,
      yarn_bring_shipment_number: result.shipmentNumber,
      label_free_code: result.labelFreeCode ?? null,
    })
    .eq('id', request_id);

  return redirect(`/marked/oppdrag/${request_id}`, 303);
};
