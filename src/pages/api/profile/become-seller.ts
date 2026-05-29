import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCurrentUser } from '../../../lib/auth';
import { createAdminSupabase } from '../../../lib/supabase';
import { createSellerConnectAccount } from '../../../lib/services/stripe-connect';
import { normalizeKontonummer, isValidKontonummer } from '../../../lib/kontonummer';

function fail(reason: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: `/profile/become-seller?error=${reason}` },
  });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const legalName = String(form.get('legal_name') ?? '').trim();
  const birthdate = String(form.get('birthdate') ?? '').trim();
  const kontonummer = String(form.get('kontonummer') ?? '').trim();
  const address = String(form.get('address') ?? '').trim();
  const postalCode = String(form.get('postal_code') ?? '').trim();
  const city = String(form.get('city') ?? '').trim();
  const terms = form.get('terms') === '1';

  if (!terms) return fail('missing_terms');
  if (!legalName || legalName.split(/\s+/).length < 2) return fail('bad_name');
  if (!birthdate) return fail('bad_birthdate');
  if (!isValidKontonummer(kontonummer)) return fail('bad_kontonummer');

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

  // Check if we already have a Stripe Connect account on file — if so,
  // skip account creation and just save the latest field values.
  const { data: existing } = await admin
    .from('profiles')
    .select('stripe_account_id, stripe_connect_status')
    .eq('id', user.id)
    .maybeSingle();

  let accountId = existing?.stripe_account_id as string | null;

  if (!accountId) {
    const result = await createSellerConnectAccount(env.STRIPE_SECRET_KEY, {
      legalName,
      birthdate,
      kontonummer,
      address,
      postalCode,
      city,
      email: user.email ?? '',
    });
    if (!result.ok) {
      console.error('Become-seller create failed', result);
      return fail(result.reason ?? 'server_error');
    }
    accountId = result.accountId ?? null;
  }

  await admin
    .from('profiles')
    .update({
      seller_legal_name: legalName,
      seller_birthdate: birthdate,
      seller_kontonummer: normalizeKontonummer(kontonummer),
      seller_address: address,
      seller_postal_code: postalCode,
      seller_city: city,
      seller_terms_accepted_at: new Date().toISOString(),
      stripe_account_id: accountId,
      stripe_connect_status: existing?.stripe_connect_status === 'verified'
        ? 'verified'
        : 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  return new Response(null, {
    status: 302,
    headers: { Location: '/profile/become-seller?submitted=1' },
  });
};
