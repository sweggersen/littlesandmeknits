import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { createServerSupabase } from '../../../lib/supabase';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../../../lib/storage';

const toIntOrNull = (v: FormDataEntryValue | null): number | null => {
  if (!v) return null;
  const n = parseInt(v.toString(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn?next=/studio/garn/ny');

  const form = await request.formData();
  const brand = form.get('brand')?.toString().trim();
  const name = form.get('name')?.toString().trim();
  if (!brand || !name) return new Response('Brand and name required', { status: 400 });

  const color = form.get('color')?.toString().trim() || null;
  const weight = form.get('weight')?.toString().trim() || null;
  const fiber = form.get('fiber')?.toString().trim() || null;
  const notes = form.get('notes')?.toString().trim() || null;
  const total_grams = toIntOrNull(form.get('total_grams'));
  const total_meters = toIntOrNull(form.get('total_meters'));

  const supabase = createServerSupabase({ request, cookies });
  const { data, error } = await supabase
    .from('yarns')
    .insert({
      user_id: user.id,
      brand,
      name,
      color,
      weight,
      fiber,
      notes,
      total_grams,
      total_meters,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('Yarn create failed', error);
    return new Response('Could not create yarn', { status: 500 });
  }

  const photoFile = form.get('photo');
  if (photoFile instanceof File && photoFile.size > 0) {
    if (photoFile.size <= MAX_PHOTO_BYTES && ALLOWED_IMAGE_TYPES.has(photoFile.type)) {
      const ext = extFromMime(photoFile.type);
      const path = `${user.id}/yarns/${data.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('projects')
        .upload(path, photoFile, { contentType: photoFile.type, upsert: false });
      if (!upErr) {
        await supabase.from('yarns').update({ photo_path: path }).eq('id', data.id);
      } else {
        console.error('Yarn photo upload failed', upErr);
      }
    }
  }

  return redirect(`/studio/garn/${data.id}`, 303);
};
