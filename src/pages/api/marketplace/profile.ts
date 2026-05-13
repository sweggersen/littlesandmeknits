import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { updateMarketplaceProfile } from '../../../lib/services/profile';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const avatarFile = form.get('avatar');
  const result = await updateMarketplaceProfile(ctx, {
    displayName: form.get('display_name')?.toString(),
    bio: form.get('bio')?.toString(),
    location: form.get('location')?.toString(),
    instagramHandle: form.get('instagram_handle')?.toString(),
    sellerTags: form.getAll('seller_tags').map((t) => t.toString()),
    profileVisible: form.get('profile_visible') === '1',
    avatar: avatarFile instanceof File ? avatarFile : null,
  });
  return toResponse(result, redirect);
};
