import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../../../../lib/storage';

const MAX_PHOTOS_PER_LOG = 6;

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const projectId = params.id;
  if (!projectId) return new Response('Missing project', { status: 400 });

  const form = await request.formData();
  const body = form.get('body')?.toString().trim();
  if (!body) return new Response('Body required', { status: 400 });

  const rawDate = form.get('log_date')?.toString();
  const log_date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : new Date().toISOString().slice(0, 10);

  const rawRows = form.get('rows_at')?.toString().trim();
  const rowsAt = rawRows ? Number.parseInt(rawRows, 10) : null;
  const rows_at = Number.isFinite(rowsAt) && (rowsAt as number) >= 0 && (rowsAt as number) <= 100000
    ? rowsAt
    : null;

  const supabase = createServerSupabase({ request, cookies });

  const photoFiles = form
    .getAll('photos')
    .filter((p): p is File => p instanceof File && p.size > 0)
    .slice(0, MAX_PHOTOS_PER_LOG);

  const uploadedPaths: string[] = [];
  for (const file of photoFiles) {
    if (file.size > MAX_PHOTO_BYTES) continue;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) continue;
    const ext = extFromMime(file.type);
    const path = `${user.id}/${projectId}/log-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('projects')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      console.error('Log photo upload failed', upErr);
      continue;
    }
    uploadedPaths.push(path);
  }

  const { error } = await supabase.from('project_logs').insert({
    project_id: projectId,
    user_id: user.id,
    body,
    log_date,
    photos: uploadedPaths,
    rows_at,
  });

  if (error) {
    console.error('Log insert failed', error);
    return new Response('Could not save log', { status: 500 });
  }

  // If the log carries a row count, advance the project's current_rows to match
  // (only forward — a log of an earlier checkpoint shouldn't roll the meter back).
  if (rows_at !== null) {
    const { data: existing } = await supabase
      .from('projects')
      .select('current_rows')
      .eq('id', projectId)
      .maybeSingle();
    const prev = (existing?.current_rows as number | null) ?? 0;
    if ((rows_at as number) > prev) {
      await supabase.from('projects').update({ current_rows: rows_at }).eq('id', projectId);
    }
  }

  return redirect(`/studio/prosjekter/${projectId}`, 303);
};
