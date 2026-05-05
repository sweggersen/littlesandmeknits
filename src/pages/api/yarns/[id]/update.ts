import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../../../../lib/storage';

const toIntOrNull = (v: FormDataEntryValue | null): number | null => {
  if (!v) return null;
  const n = parseInt(v.toString(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const yarnId = params.id;
  if (!yarnId) return new Response('Missing id', { status: 400 });

  const form = await request.formData();
  const brand = form.get('brand')?.toString().trim();
  const name = form.get('name')?.toString().trim();
  if (!brand || !name) return new Response('Brand and name required', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  const patch: Record<string, unknown> = {
    brand,
    name,
    color: form.get('color')?.toString().trim() || null,
    weight: form.get('weight')?.toString().trim() || null,
    fiber: form.get('fiber')?.toString().trim() || null,
    notes: form.get('notes')?.toString().trim() || null,
    total_grams: toIntOrNull(form.get('total_grams')),
    total_meters: toIntOrNull(form.get('total_meters')),
  };

  const photoFile = form.get('photo');
  if (photoFile instanceof File && photoFile.size > 0) {
    if (photoFile.size > MAX_PHOTO_BYTES) return new Response('Photo too large', { status: 400 });
    if (!ALLOWED_IMAGE_TYPES.has(photoFile.type)) return new Response('Unsupported image type', { status: 400 });
    const ext = extFromMime(photoFile.type);
    const path = `${user.id}/yarns/${yarnId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('projects')
      .upload(path, photoFile, { contentType: photoFile.type, upsert: false });
    if (upErr) {
      console.error('Yarn photo upload failed', upErr);
      return new Response('Upload failed', { status: 500 });
    }
    patch.photo_path = path;
  }

  const { error } = await supabase.from('yarns').update(patch).eq('id', yarnId);
  if (error) {
    console.error('Yarn update failed', error);
    return new Response('Could not update', { status: 500 });
  }

  return redirect(`/studio/garn/${yarnId}`, 303);
};
