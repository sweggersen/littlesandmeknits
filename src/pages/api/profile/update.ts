import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { createServerSupabase } from '../../../lib/supabase';

const VALID_LANGS = new Set(['nb', 'en']);

function cleanHandle(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@+/, '');
  if (!trimmed) return null;
  // Instagram handles: 1–30 chars, letters/digits/dots/underscores.
  if (!/^[A-Za-z0-9._]{1,30}$/.test(trimmed)) return null;
  return trimmed;
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const form = await request.formData();
  const displayName = form.get('display_name')?.toString().trim().slice(0, 60) || null;
  const instagram = cleanHandle(form.get('instagram_handle')?.toString());
  const langRaw = form.get('language')?.toString();
  const language = langRaw && VALID_LANGS.has(langRaw) ? langRaw : null;

  const next = form.get('next')?.toString() || '/studio/profil';

  const supabase = createServerSupabase({ request, cookies });
  // Merge into existing metadata so we don't blow away other fields.
  const merged = {
    ...(user.user_metadata ?? {}),
    display_name: displayName,
    instagram_handle: instagram,
    language: language,
  };
  const { error } = await supabase.auth.updateUser({ data: merged });
  if (error) {
    console.error('Profile update failed', error);
    return new Response('Could not update profile', { status: 500 });
  }

  return redirect(next, 303);
};
