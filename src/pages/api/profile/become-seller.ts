import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { becomeSeller } from '../../../lib/services/profile';

// UI errors are query params on /profile/become-seller. Map the service's
// fine-grained bad_input messages straight through; otherwise fall back
// to a generic server_error label so the form can show 'something went wrong'.
function errorRedirect(reason: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `/profile/become-seller?error=${reason}` },
  });
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  if (form.get('terms') !== '1') return errorRedirect('missing_terms');

  const result = await becomeSeller(ctx, {
    legalName: String(form.get('legal_name') ?? ''),
    birthdate: String(form.get('birthdate') ?? '').trim(),
    kontonummer: String(form.get('kontonummer') ?? '').trim(),
    address: String(form.get('address') ?? '').trim(),
    postalCode: String(form.get('postal_code') ?? '').trim(),
    city: String(form.get('city') ?? '').trim(),
  });

  if (!result.ok) {
    return errorRedirect(result.code === 'bad_input' ? result.message : 'server_error');
  }
  return redirect(result.data.redirect, 303);
};
