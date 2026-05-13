import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { createNotification } from '../notify';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../storage';
import { VALID_PROJECT_STATUSES } from '../labels';
import { slugify, randomSuffix } from '../slug';
import { reconcileYarnDeductions } from '../yarn-deduction';

const MAX_PHOTOS_PER_LOG = 6;

const toIntOrNull = (v: string | undefined | null): number | null => {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function createProject(
  ctx: ServiceContext,
  input: {
    title: string; status?: string; summary?: string; recipient?: string;
    targetSize?: string; yarn?: string; needles?: string;
    patternSlug?: string; patternExternal?: string; heroPhoto?: File | null;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  const title = input.title.trim();
  if (!title) return fail('bad_input', 'Title required');

  const status = input.status ?? 'active';
  if (!VALID_PROJECT_STATUSES.has(status)) return fail('bad_input', 'Invalid status');

  const { data, error } = await ctx.supabase
    .from('projects')
    .insert({
      user_id: ctx.user.id, title,
      summary: input.summary?.trim() || null,
      status,
      recipient: input.recipient?.trim() || null,
      target_size: input.targetSize?.trim() || null,
      yarn: input.yarn?.trim() || null,
      needles: input.needles?.trim() || null,
      pattern_slug: input.patternSlug?.trim() || null,
      pattern_external: input.patternExternal?.trim() || null,
      started_at: status !== 'planning' ? new Date().toISOString().slice(0, 10) : null,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('Project create failed', error);
    return fail('server_error', 'Could not create project');
  }

  if (input.heroPhoto instanceof File && input.heroPhoto.size > 0) {
    const file = input.heroPhoto;
    if (file.size <= MAX_PHOTO_BYTES && ALLOWED_IMAGE_TYPES.has(file.type)) {
      const ext = extFromMime(file.type);
      const path = `${ctx.user.id}/${data.id}/hero-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await ctx.supabase.storage
        .from('projects')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (!upErr) {
        await ctx.supabase.from('projects').update({ hero_photo_path: path }).eq('id', data.id);
      }
    }
  }

  return ok({ redirect: `/studio/prosjekter/${data.id}` });
}

export async function deleteProject(
  ctx: ServiceContext,
  input: { projectId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.projectId) return fail('bad_input', 'Missing project');

  const { error } = await ctx.supabase.from('projects').delete().eq('id', input.projectId);
  if (error) {
    console.error('Project delete failed', error);
    return fail('server_error', 'Could not delete');
  }

  return ok({ redirect: '/studio/prosjekter' });
}

export async function addProgressLog(
  ctx: ServiceContext,
  input: {
    projectId: string; body: string; logDate?: string;
    rowsAt?: string; photos: File[];
  },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.projectId) return fail('bad_input', 'Missing project');
  const body = input.body.trim();
  if (!body) return fail('bad_input', 'Body required');

  const logDate = input.logDate && /^\d{4}-\d{2}-\d{2}$/.test(input.logDate)
    ? input.logDate
    : new Date().toISOString().slice(0, 10);

  const rawRows = input.rowsAt?.trim();
  const rowsAtParsed = rawRows ? parseInt(rawRows, 10) : null;
  const rowsAt = Number.isFinite(rowsAtParsed) && rowsAtParsed! >= 0 && rowsAtParsed! <= 100000
    ? rowsAtParsed
    : null;

  const photoFiles = input.photos
    .filter((p) => p instanceof File && p.size > 0)
    .slice(0, MAX_PHOTOS_PER_LOG);

  const uploadResults = await Promise.all(
    photoFiles
      .filter((file) => file.size <= MAX_PHOTO_BYTES && ALLOWED_IMAGE_TYPES.has(file.type))
      .map(async (file) => {
        const ext = extFromMime(file.type);
        const path = `${ctx.user.id}/${input.projectId}/log-${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await ctx.supabase.storage
          .from('projects')
          .upload(path, file, { contentType: file.type, upsert: false });
        return upErr ? null : path;
      }),
  );
  const uploadedPaths = uploadResults.filter((p): p is string => p !== null);

  const { error } = await ctx.supabase.from('project_logs').insert({
    project_id: input.projectId,
    user_id: ctx.user.id,
    body, log_date: logDate, photos: uploadedPaths, rows_at: rowsAt,
  });

  if (error) {
    console.error('Log insert failed', error);
    return fail('server_error', 'Could not save log');
  }

  if (rowsAt !== null) {
    const { data: existing } = await ctx.supabase
      .from('projects').select('current_rows').eq('id', input.projectId).maybeSingle();
    const prev = (existing?.current_rows as number | null) ?? 0;
    if (rowsAt > prev) {
      await ctx.supabase.from('projects').update({ current_rows: rowsAt }).eq('id', input.projectId);
    }
  }

  const { data: proj } = await ctx.supabase
    .from('projects').select('title, commission_offer_id').eq('id', input.projectId).maybeSingle();

  if (proj?.commission_offer_id) {
    const { data: offerData } = await ctx.admin
      .from('commission_offers')
      .select('request_id, commission_requests!commission_offers_request_id_fkey(buyer_id)')
      .eq('id', proj.commission_offer_id)
      .maybeSingle();
    const reqInfo = (offerData as any)?.commission_requests;
    if (reqInfo?.buyer_id) {
      await createNotification(ctx.admin, {
        userId: reqInfo.buyer_id, type: 'project_update',
        title: 'Ny oppdatering!',
        body: `Strikkeren har lagt til en oppdatering på «${proj.title}».`,
        url: `/marked/oppdrag/${offerData!.request_id}`,
        actorId: ctx.user.id, referenceId: input.projectId,
      }, ctx.env);
    }
  }

  return ok({ redirect: `/studio/prosjekter/${input.projectId}` });
}

export async function deleteProgressLog(
  ctx: ServiceContext,
  input: { projectId: string; logId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.projectId || !input.logId) return fail('bad_input', 'Missing id');

  const { error } = await ctx.supabase
    .from('project_logs').delete().eq('id', input.logId).eq('project_id', input.projectId);

  if (error) {
    console.error('Log delete failed', error);
    return fail('server_error', 'Could not delete');
  }

  return ok({ redirect: `/studio/prosjekter/${input.projectId}` });
}

export async function uploadProjectPhoto(
  ctx: ServiceContext,
  input: { projectId: string; heroPhoto: File | null },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.projectId) return fail('bad_input', 'Missing project');

  if (!input.heroPhoto || !(input.heroPhoto instanceof File) || input.heroPhoto.size === 0) {
    await ctx.supabase.from('projects').update({ hero_photo_path: null }).eq('id', input.projectId);
    return ok({ redirect: `/studio/prosjekter/${input.projectId}` });
  }

  const file = input.heroPhoto;
  if (file.size > MAX_PHOTO_BYTES) return fail('bad_input', 'Photo too large');
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return fail('bad_input', 'Unsupported image type');

  const ext = extFromMime(file.type);
  const path = `${ctx.user.id}/${input.projectId}/hero-${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await ctx.supabase.storage
    .from('projects')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) {
    console.error('Hero upload failed', upErr);
    return fail('server_error', 'Upload failed');
  }

  const { error } = await ctx.supabase
    .from('projects').update({ hero_photo_path: path }).eq('id', input.projectId);
  if (error) {
    console.error('Hero path update failed', error);
    return fail('server_error', 'Could not save');
  }

  return ok({ redirect: `/studio/prosjekter/${input.projectId}` });
}

export async function updateProgress(
  ctx: ServiceContext,
  input: { projectId: string; targetRows?: string; currentRows?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.projectId) return fail('bad_input', 'Missing project');

  const target = toIntOrNull(input.targetRows);
  const current = toIntOrNull(input.currentRows);
  const cap = (n: number | null) => (n !== null && n > 100000 ? 100000 : n);

  const { error } = await ctx.supabase
    .from('projects')
    .update({ target_rows: cap(target), current_rows: cap(current) })
    .eq('id', input.projectId);

  if (error) {
    console.error('Progress update failed', error);
    return fail('server_error', 'Could not update');
  }

  return ok({ redirect: `/studio/prosjekter/${input.projectId}` });
}

export async function shareProject(
  ctx: ServiceContext,
  input: { projectId: string; share: boolean },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.projectId) return fail('bad_input', 'Missing project');

  if (!input.share) {
    const { error } = await ctx.supabase
      .from('projects').update({ public_slug: null }).eq('id', input.projectId);
    if (error) return fail('server_error', 'Could not update');
    return ok({ redirect: `/studio/prosjekter/${input.projectId}` });
  }

  const { data: project, error: fetchErr } = await ctx.supabase
    .from('projects').select('id, title, public_slug').eq('id', input.projectId).maybeSingle();
  if (fetchErr || !project) return fail('not_found', 'Not found');
  if (project.public_slug) return ok({ redirect: `/studio/prosjekter/${input.projectId}` });

  const base = slugify(project.title);
  let attempt = `${base}-${randomSuffix(4)}`;
  for (let i = 0; i < 5; i++) {
    const { error: upErr } = await ctx.supabase
      .from('projects').update({ public_slug: attempt }).eq('id', input.projectId);
    if (!upErr) break;
    attempt = `${base}-${randomSuffix(6)}`;
    if (i === 4) return fail('server_error', 'Could not generate share link');
  }

  return ok({ redirect: `/studio/prosjekter/${input.projectId}` });
}

export async function updateStatus(
  ctx: ServiceContext,
  input: { projectId: string; status: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.projectId) return fail('bad_input', 'Missing project');
  if (!VALID_PROJECT_STATUSES.has(input.status)) return fail('bad_input', 'Invalid status');

  type Patch = { status: string; finished_at?: string | null };
  const patch: Patch = { status: input.status };
  if (input.status === 'finished') {
    patch.finished_at = new Date().toISOString().slice(0, 10);
  } else if (['planning', 'active', 'frogged'].includes(input.status)) {
    patch.finished_at = null;
  }

  const { error } = await ctx.supabase.from('projects').update(patch).eq('id', input.projectId);
  if (error) {
    console.error('Status update failed', error);
    return fail('server_error', 'Could not update');
  }

  await reconcileYarnDeductions(ctx.supabase, input.projectId, input.status);

  return ok({ redirect: `/studio/prosjekter/${input.projectId}` });
}

export async function linkYarn(
  ctx: ServiceContext,
  input: { projectId: string; yarnId: string; gramsUsed: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.projectId) return fail('bad_input', 'Missing project');
  const yarnId = input.yarnId.trim();
  const gramsUsed = toIntOrNull(input.gramsUsed);
  if (!yarnId || gramsUsed === null) return fail('bad_input', 'Yarn and grams required');

  const { data: existing } = await ctx.supabase
    .from('project_yarns')
    .select('id, grams_used, deducted_at')
    .eq('project_id', input.projectId)
    .eq('yarn_id', yarnId)
    .maybeSingle();

  if (existing) {
    if (existing.deducted_at) {
      const { data: yarn } = await ctx.supabase
        .from('yarns').select('total_grams').eq('id', yarnId).maybeSingle();
      const current = (yarn?.total_grams as number | null | undefined) ?? 0;
      await ctx.supabase.from('yarns').update({ total_grams: current + (existing.grams_used as number) }).eq('id', yarnId);
    }
    await ctx.supabase.from('project_yarns').update({ grams_used: gramsUsed, deducted_at: null }).eq('id', existing.id);
  } else {
    const { error: insErr } = await ctx.supabase
      .from('project_yarns').insert({ project_id: input.projectId, yarn_id: yarnId, grams_used: gramsUsed });
    if (insErr) {
      console.error('Project yarn insert failed', insErr);
      return fail('server_error', 'Could not attach yarn');
    }
  }

  const { data: project } = await ctx.supabase
    .from('projects').select('status').eq('id', input.projectId).maybeSingle();
  await reconcileYarnDeductions(ctx.supabase, input.projectId, (project?.status as string) ?? 'planning');

  return ok({ redirect: `/studio/prosjekter/${input.projectId}` });
}

export async function unlinkYarn(
  ctx: ServiceContext,
  input: { projectId: string; linkId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.projectId || !input.linkId) return fail('bad_input', 'Missing ids');

  const { data: link } = await ctx.supabase
    .from('project_yarns')
    .select('yarn_id, grams_used, deducted_at')
    .eq('id', input.linkId)
    .maybeSingle();

  if (link?.deducted_at && link.yarn_id && typeof link.grams_used === 'number') {
    const { data: yarn } = await ctx.supabase
      .from('yarns').select('total_grams').eq('id', link.yarn_id).maybeSingle();
    const current = (yarn?.total_grams as number | null | undefined) ?? 0;
    await ctx.supabase.from('yarns').update({ total_grams: current + link.grams_used }).eq('id', link.yarn_id);
  }

  const { error } = await ctx.supabase.from('project_yarns').delete().eq('id', input.linkId);
  if (error) {
    console.error('Project yarn delete failed', error);
    return fail('server_error', 'Could not detach yarn');
  }

  return ok({ redirect: `/studio/prosjekter/${input.projectId}` });
}
