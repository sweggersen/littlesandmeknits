import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import {
  ALLOWED_IMAGE_TYPES, ALLOWED_PATTERN_TYPES,
  MAX_PHOTO_BYTES, MAX_PATTERN_BYTES, patternFileExt, extFromMime,
} from '../storage';

export async function createPattern(
  ctx: ServiceContext,
  input: {
    title: string; designer?: string; sourceUrl?: string; notes?: string;
    file?: File | null; cover?: File | null;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  const title = input.title.trim();
  if (!title) return fail('bad_input', 'Title required');

  const { data, error } = await ctx.supabase
    .from('external_patterns')
    .insert({
      user_id: ctx.user.id, title,
      designer: input.designer?.trim() || null,
      source_url: input.sourceUrl?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('External pattern create failed', error);
    return fail('server_error', 'Could not create');
  }

  const id = data.id as string;
  let filePath: string | null = null;
  let coverPath: string | null = null;

  if (input.file instanceof File && input.file.size > 0) {
    if (input.file.size <= MAX_PATTERN_BYTES && ALLOWED_PATTERN_TYPES.has(input.file.type)) {
      const ext = patternFileExt(input.file.type);
      const path = `${ctx.user.id}/external-patterns/${id}/file-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await ctx.supabase.storage
        .from('projects').upload(path, input.file, { contentType: input.file.type, upsert: false });
      if (!upErr) {
        filePath = path;
        if (ALLOWED_IMAGE_TYPES.has(input.file.type)) coverPath = path;
      }
    }
  }

  if (input.cover instanceof File && input.cover.size > 0) {
    if (input.cover.size <= MAX_PHOTO_BYTES && ALLOWED_IMAGE_TYPES.has(input.cover.type)) {
      const ext = extFromMime(input.cover.type);
      const path = `${ctx.user.id}/external-patterns/${id}/cover-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await ctx.supabase.storage
        .from('projects').upload(path, input.cover, { contentType: input.cover.type, upsert: false });
      if (!upErr) coverPath = path;
    }
  }

  if (filePath || coverPath) {
    await ctx.supabase.from('external_patterns')
      .update({ file_path: filePath, cover_path: coverPath }).eq('id', id);
  }

  return ok({ redirect: `/profil/bibliotek/${id}` });
}

export async function updatePattern(
  ctx: ServiceContext,
  input: {
    patternId: string; title: string; designer?: string;
    sourceUrl?: string; notes?: string; file?: File | null; cover?: File | null;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.patternId) return fail('bad_input', 'Missing id');
  const title = input.title.trim();
  if (!title) return fail('bad_input', 'Title required');

  const patch: Record<string, unknown> = {
    title,
    designer: input.designer?.trim() || null,
    source_url: input.sourceUrl?.trim() || null,
    notes: input.notes?.trim() || null,
  };

  if (input.file instanceof File && input.file.size > 0) {
    if (input.file.size <= MAX_PATTERN_BYTES && ALLOWED_PATTERN_TYPES.has(input.file.type)) {
      const ext = patternFileExt(input.file.type);
      const path = `${ctx.user.id}/external-patterns/${input.patternId}/file-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await ctx.supabase.storage
        .from('projects').upload(path, input.file, { contentType: input.file.type, upsert: false });
      if (!upErr) {
        patch.file_path = path;
        if (ALLOWED_IMAGE_TYPES.has(input.file.type)) patch.cover_path = path;
      }
    }
  }

  if (input.cover instanceof File && input.cover.size > 0) {
    if (input.cover.size <= MAX_PHOTO_BYTES && ALLOWED_IMAGE_TYPES.has(input.cover.type)) {
      const ext = extFromMime(input.cover.type);
      const path = `${ctx.user.id}/external-patterns/${input.patternId}/cover-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await ctx.supabase.storage
        .from('projects').upload(path, input.cover, { contentType: input.cover.type, upsert: false });
      if (!upErr) patch.cover_path = path;
    }
  }

  const { error } = await ctx.supabase.from('external_patterns').update(patch).eq('id', input.patternId);
  if (error) {
    console.error('External pattern update failed', error);
    return fail('server_error', 'Could not update');
  }

  return ok({ redirect: `/profil/bibliotek/${input.patternId}` });
}

export async function deletePattern(
  ctx: ServiceContext,
  input: { patternId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.patternId) return fail('bad_input', 'Missing id');

  const { data: row } = await ctx.supabase
    .from('external_patterns')
    .select('file_path, cover_path')
    .eq('id', input.patternId)
    .maybeSingle();

  const paths = [row?.file_path, row?.cover_path].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  const unique = Array.from(new Set(paths));
  if (unique.length > 0) {
    await ctx.supabase.storage.from('projects').remove(unique);
  }

  const { error } = await ctx.supabase.from('external_patterns').delete().eq('id', input.patternId);
  if (error) {
    console.error('External pattern delete failed', error);
    return fail('server_error', 'Could not delete');
  }

  return ok({ redirect: '/profil/bibliotek' });
}
