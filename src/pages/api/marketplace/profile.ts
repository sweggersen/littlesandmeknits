import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { createServerSupabase } from '../../../lib/supabase';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../../../lib/storage';

const VALID_TAGS = new Set(['knitter', 'sells_pre_loved', 'sells_ready_made', 'open_for_requests', 'dyer']);

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const supabase = createServerSupabase({ request, cookies });
  const form = await request.formData();

  const displayName = form.get('display_name')?.toString().trim().slice(0, 60) || null;
  const bio = form.get('bio')?.toString().trim().slice(0, 500) || null;
  const location = form.get('location')?.toString().trim().slice(0, 100) || null;
  const instagram = form.get('instagram_handle')?.toString().trim().replace(/^@+/, '').slice(0, 30) || null;
  const sellerTags = form.getAll('seller_tags')
    .map((t) => t.toString())
    .filter((t) => VALID_TAGS.has(t));
  const profileVisible = form.get('profile_visible') === '1';

  // Avatar upload
  const avatarFile = form.get('avatar');
  let avatarPath: string | undefined;
  if (avatarFile instanceof File && avatarFile.size > 0) {
    if (avatarFile.size > MAX_PHOTO_BYTES) {
      return new Response('Bildet er for stort (maks 10 MB)', { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.has(avatarFile.type)) {
      return new Response('Filtypen støttes ikke', { status: 400 });
    }
    const ext = extFromMime(avatarFile.type);
    avatarPath = `${user.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('projects')
      .upload(avatarPath, avatarFile, { contentType: avatarFile.type, upsert: true });
    if (upErr) {
      console.error('Avatar upload failed', upErr);
      return new Response('Opplasting feilet', { status: 500 });
    }
  }

  const update: Record<string, unknown> = {
    display_name: displayName,
    bio,
    location,
    instagram_handle: instagram,
    seller_tags: sellerTags,
    profile_visible: profileVisible,
    updated_at: new Date().toISOString(),
  };
  if (avatarPath) update.avatar_path = avatarPath;

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', user.id);

  if (error) {
    console.error('Profile update failed', error);
    return new Response('Kunne ikke oppdatere profil', { status: 500 });
  }

  return redirect('/marked/profil?saved=1', 303);
};
