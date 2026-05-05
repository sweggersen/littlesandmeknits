import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { createServerSupabase } from '../../../lib/supabase';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../../../lib/storage';

const VALID_STATUS = new Set(['planning', 'active', 'finished', 'frogged']);

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn?next=/studio/prosjekter/ny');

  const form = await request.formData();
  const title = form.get('title')?.toString().trim();
  if (!title) return new Response('Title required', { status: 400 });

  const status = form.get('status')?.toString() ?? 'active';
  if (!VALID_STATUS.has(status)) return new Response('Invalid status', { status: 400 });

  const summary = form.get('summary')?.toString().trim() || null;
  const recipient = form.get('recipient')?.toString().trim() || null;
  const target_size = form.get('target_size')?.toString().trim() || null;
  const yarn = form.get('yarn')?.toString().trim() || null;
  const needles = form.get('needles')?.toString().trim() || null;
  const pattern_slug = form.get('pattern_slug')?.toString().trim() || null;
  const pattern_external = form.get('pattern_external')?.toString().trim() || null;

  const supabase = createServerSupabase({ request, cookies });
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      title,
      summary,
      status,
      recipient,
      target_size,
      yarn,
      needles,
      pattern_slug,
      pattern_external,
      started_at: status !== 'planning' ? new Date().toISOString().slice(0, 10) : null,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('Project create failed', error);
    return new Response('Could not create project', { status: 500 });
  }

  // Optional hero photo upload
  const heroFile = form.get('hero_photo');
  if (heroFile instanceof File && heroFile.size > 0) {
    if (heroFile.size > MAX_PHOTO_BYTES) {
      console.warn('Hero photo too large, skipped');
    } else if (!ALLOWED_IMAGE_TYPES.has(heroFile.type)) {
      console.warn('Hero photo wrong type, skipped:', heroFile.type);
    } else {
      const ext = extFromMime(heroFile.type);
      const path = `${user.id}/${data.id}/hero-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('projects')
        .upload(path, heroFile, { contentType: heroFile.type, upsert: false });
      if (upErr) {
        console.error('Hero upload failed', upErr);
      } else {
        await supabase.from('projects').update({ hero_photo_path: path }).eq('id', data.id);
      }
    }
  }

  return redirect(`/studio/prosjekter/${data.id}`, 303);
};
