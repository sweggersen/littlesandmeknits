import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { becomeSeller } from '../../../lib/services/profile';

// Cookie carrying the just-submitted form values back to the page on a
// validation error, so a failed attempt doesn't wipe what the user typed.
// Short-lived + httpOnly + path-scoped; it's the user's own data (incl.
// account number / birthdate), so it must not go in the URL.
const FLASH_COOKIE = 'bs_form';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const values = {
    legal_name: String(form.get('legal_name') ?? ''),
    birthdate: String(form.get('birthdate') ?? '').trim(),
    kontonummer: String(form.get('kontonummer') ?? '').trim(),
    address: String(form.get('address') ?? '').trim(),
    postal_code: String(form.get('postal_code') ?? '').trim(),
    city: String(form.get('city') ?? '').trim(),
  };

  // UI errors are query params on /profile/become-seller. Map the service's
  // fine-grained bad_input messages straight through; otherwise fall back to a
  // generic server_error label. Stash the submitted values so the form refills.
  const fail = (reason: string): Response => {
    // Bind to the user id so a different account on a shared browser can't
    // inherit the prefill (the page ignores the cookie unless uid matches).
    cookies.set(FLASH_COOKIE, JSON.stringify({ ...values, uid: ctx.user.id }), {
      path: '/profile/become-seller',
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
      maxAge: 300,
    });
    return redirect(`/profile/become-seller?error=${reason}`, 303);
  };

  if (form.get('terms') !== '1') return fail('missing_terms');

  const result = await becomeSeller(ctx, {
    legalName: values.legal_name,
    birthdate: values.birthdate,
    kontonummer: values.kontonummer,
    address: values.address,
    postalCode: values.postal_code,
    city: values.city,
  });

  if (!result.ok) {
    return fail(result.code === 'bad_input' ? result.message : 'server_error');
  }
  return redirect(result.data.redirect, 303);
};
