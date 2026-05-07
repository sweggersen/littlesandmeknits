import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../../lib/auth';
import { createServerSupabase } from '../../../../../lib/supabase';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../../../../../lib/storage';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  const { data: listing } = await supabase
    .from('listings')
    .select('id, seller_id')
    .eq('id', id)
    .maybeSingle();
  if (!listing || listing.seller_id !== user.id) {
    return new Response('Not found', { status: 404 });
  }

  const form = await request.formData();
  const file = form.get('hero_photo');

  if (!(file instanceof File) || file.size === 0) {
    await supabase.from('listings').update({ hero_photo_path: null }).eq('id', id);
    return redirect(`/marked/listing/${id}`, 303);
  }

  if (file.size > MAX_PHOTO_BYTES) return new Response('Photo too large (max 10 MB)', { status: 400 });
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return new Response('Unsupported image type', { status: 400 });

  const ext = extFromMime(file.type);
  const path = `${user.id}/listings/${id}/hero-${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('projects')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) {
    console.error('Listing photo upload failed', upErr);
    return new Response('Upload failed', { status: 500 });
  }

  const { error } = await supabase
    .from('listings')
    .update({ hero_photo_path: path })
    .eq('id', id);
  if (error) {
    console.error('Listing photo path update failed', error);
    return new Response('Could not save', { status: 500 });
  }

  return redirect(`/marked/listing/${id}`, 303);
};
