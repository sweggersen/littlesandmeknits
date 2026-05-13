import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { editProfile } from '../../../lib/services/profile';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await editProfile(ctx, {
    displayName: form.get('display_name')?.toString(),
    bio: form.get('bio')?.toString(),
    location: form.get('location')?.toString(),
    instagramHandle: form.get('instagram_handle')?.toString(),
    language: form.get('language')?.toString(),
    sellerTags: form.getAll('seller_tags').map((v) => v.toString()),
    profileVisible: form.get('profile_visible') === '1',
    avatar: form.get('avatar') as File | null,
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
