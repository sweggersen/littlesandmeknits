import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../../../../lib/storage';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const projectId = params.id;
  if (!projectId) return new Response('Missing project', { status: 400 });

  const form = await request.formData();
  const file = form.get('hero_photo');

  const supabase = createServerSupabase({ request, cookies });

  // Empty submission means "remove the hero photo"
  if (!(file instanceof File) || file.size === 0) {
    await supabase.from('projects').update({ hero_photo_path: null }).eq('id', projectId);
    return redirect(`/studio/prosjekter/${projectId}`, 303);
  }

  if (file.size > MAX_PHOTO_BYTES) return new Response('Photo too large', { status: 400 });
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return new Response('Unsupported image type', { status: 400 });

  const ext = extFromMime(file.type);
  const path = `${user.id}/${projectId}/hero-${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('projects')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) {
    console.error('Hero upload failed', upErr);
    return new Response('Upload failed', { status: 500 });
  }

  const { error } = await supabase
    .from('projects')
    .update({ hero_photo_path: path })
    .eq('id', projectId);
  if (error) {
    console.error('Hero path update failed', error);
    return new Response('Could not save', { status: 500 });
  }

  return redirect(`/studio/prosjekter/${projectId}`, 303);
};
