import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_PATTERN_TYPES,
  MAX_PHOTO_BYTES,
  MAX_PATTERN_BYTES,
  patternFileExt,
  extFromMime,
} from '../../../../lib/storage';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  const form = await request.formData();
  const title = form.get('title')?.toString().trim();
  if (!title) return new Response('Title required', { status: 400 });

  const designer = form.get('designer')?.toString().trim() || null;
  const source_url = form.get('source_url')?.toString().trim() || null;
  const notes = form.get('notes')?.toString().trim() || null;

  const supabase = createServerSupabase({ request, cookies });
  const patch: Record<string, unknown> = { title, designer, source_url, notes };

  const file = form.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size <= MAX_PATTERN_BYTES && ALLOWED_PATTERN_TYPES.has(file.type)) {
      const ext = patternFileExt(file.type);
      const path = `${user.id}/external-patterns/${id}/file-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('projects')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (!upErr) {
        patch.file_path = path;
        if (ALLOWED_IMAGE_TYPES.has(file.type)) patch.cover_path = path;
      } else {
        console.error('Pattern file upload failed', upErr);
      }
    }
  }

  const cover = form.get('cover');
  if (cover instanceof File && cover.size > 0) {
    if (cover.size <= MAX_PHOTO_BYTES && ALLOWED_IMAGE_TYPES.has(cover.type)) {
      const ext = extFromMime(cover.type);
      const path = `${user.id}/external-patterns/${id}/cover-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('projects')
        .upload(path, cover, { contentType: cover.type, upsert: false });
      if (!upErr) {
        patch.cover_path = path;
      } else {
        console.error('Pattern cover upload failed', upErr);
      }
    }
  }

  const { error } = await supabase.from('external_patterns').update(patch).eq('id', id);
  if (error) {
    console.error('External pattern update failed', error);
    return new Response('Could not update', { status: 500 });
  }

  return redirect(`/profil/bibliotek/${id}`, 303);
};
