import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { createServerSupabase } from '../../../lib/supabase';

const VALID_LANGS = new Set(['nb', 'en']);
const VALID_TAGS = new Set([
  'knitter', 'sells_pre_loved', 'sells_ready_made',
  'open_for_requests', 'dyer',
]);

function cleanHandle(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@+/, '');
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9._]{1,30}$/.test(trimmed)) return null;
  return trimmed;
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const form = await request.formData();
  const displayName = form.get('display_name')?.toString().trim().slice(0, 60) || null;
  const bio = form.get('bio')?.toString().trim().slice(0, 500) || null;
  const location = form.get('location')?.toString().trim().slice(0, 100) || null;
  const instagram = cleanHandle(form.get('instagram_handle')?.toString());
  const langRaw = form.get('language')?.toString();
  const language = langRaw && VALID_LANGS.has(langRaw) ? langRaw : null;
  const seller_tags = form.getAll('seller_tags').map(v => v.toString()).filter(v => VALID_TAGS.has(v));
  const profile_visible = form.get('profile_visible') === '1';

  const supabase = createServerSupabase({ request, cookies });

  // Handle avatar upload
  const avatarFile = form.get('avatar') as File | null;
  let avatar_path: string | undefined;
  if (avatarFile && avatarFile.size > 0) {
    const ext = avatarFile.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `avatars/${user.id}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('projects')
      .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
    if (!uploadError) avatar_path = path;
  }

  // Update profiles table
  const profileUpdate: Record<string, any> = {
    display_name: displayName,
    bio,
    location,
    instagram_handle: instagram,
    seller_tags,
    profile_visible,
  };
  if (avatar_path) profileUpdate.avatar_path = avatar_path;

  await supabase.from('profiles').update(profileUpdate).eq('id', user.id);

  // Update auth metadata (display_name, instagram, language)
  const merged = {
    ...(user.user_metadata ?? {}),
    display_name: displayName,
    instagram_handle: instagram,
    language,
  };
  await supabase.auth.updateUser({ data: merged });

  // Language cookie
  if (language) {
    cookies.set('lm-lang', language, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    cookies.delete('lm-lang', { path: '/' });
  }

  return redirect('/profil/rediger?saved=1', 303);
};
