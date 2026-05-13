import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { updateProfile } from '../../../lib/services/profile';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await updateProfile(ctx, {
    displayName: form.get('display_name')?.toString(),
    instagramHandle: form.get('instagram_handle')?.toString(),
    language: form.get('language')?.toString(),
    next: form.get('next')?.toString(),
  });

  if (result.ok) {
    if (result.data.language) {
      cookies.set('lm-lang', result.data.language, { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
    } else {
      cookies.delete('lm-lang', { path: '/' });
    }
  }

  return toResponse(result, redirect);
};
