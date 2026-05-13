import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../storage';

const toIntOrNull = (v: string | undefined | null): number | null => {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function createYarn(
  ctx: ServiceContext,
  input: {
    brand: string; name: string; color?: string; weight?: string;
    fiber?: string; notes?: string; totalGrams?: string; totalMeters?: string;
    photo?: File | null;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  const brand = input.brand.trim();
  const name = input.name.trim();
  if (!brand || !name) return fail('bad_input', 'Brand and name required');

  const { data, error } = await ctx.supabase
    .from('yarns')
    .insert({
      user_id: ctx.user.id, brand, name,
      color: input.color?.trim() || null,
      weight: input.weight?.trim() || null,
      fiber: input.fiber?.trim() || null,
      notes: input.notes?.trim() || null,
      total_grams: toIntOrNull(input.totalGrams),
      total_meters: toIntOrNull(input.totalMeters),
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('Yarn create failed', error);
    return fail('server_error', 'Could not create yarn');
  }

  if (input.photo instanceof File && input.photo.size > 0) {
    if (input.photo.size <= MAX_PHOTO_BYTES && ALLOWED_IMAGE_TYPES.has(input.photo.type)) {
      const ext = extFromMime(input.photo.type);
      const path = `${ctx.user.id}/yarns/${data.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await ctx.supabase.storage
        .from('projects')
        .upload(path, input.photo, { contentType: input.photo.type, upsert: false });
      if (!upErr) {
        await ctx.supabase.from('yarns').update({ photo_path: path }).eq('id', data.id);
      }
    }
  }

  return ok({ redirect: `/studio/garn/${data.id}` });
}

export async function updateYarn(
  ctx: ServiceContext,
  input: {
    yarnId: string; brand: string; name: string; color?: string; weight?: string;
    fiber?: string; notes?: string; totalGrams?: string; totalMeters?: string;
    photo?: File | null;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.yarnId) return fail('bad_input', 'Missing id');
  const brand = input.brand.trim();
  const name = input.name.trim();
  if (!brand || !name) return fail('bad_input', 'Brand and name required');

  const patch: Record<string, unknown> = {
    brand, name,
    color: input.color?.trim() || null,
    weight: input.weight?.trim() || null,
    fiber: input.fiber?.trim() || null,
    notes: input.notes?.trim() || null,
    total_grams: toIntOrNull(input.totalGrams),
    total_meters: toIntOrNull(input.totalMeters),
  };

  if (input.photo instanceof File && input.photo.size > 0) {
    if (input.photo.size > MAX_PHOTO_BYTES) return fail('bad_input', 'Photo too large');
    if (!ALLOWED_IMAGE_TYPES.has(input.photo.type)) return fail('bad_input', 'Unsupported image type');
    const ext = extFromMime(input.photo.type);
    const path = `${ctx.user.id}/yarns/${input.yarnId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await ctx.supabase.storage
      .from('projects')
      .upload(path, input.photo, { contentType: input.photo.type, upsert: false });
    if (upErr) return fail('server_error', 'Upload failed');
    patch.photo_path = path;
  }

  const { error } = await ctx.supabase.from('yarns').update(patch).eq('id', input.yarnId);
  if (error) {
    console.error('Yarn update failed', error);
    return fail('server_error', 'Could not update');
  }

  return ok({ redirect: `/studio/garn/${input.yarnId}` });
}

export async function deleteYarn(
  ctx: ServiceContext,
  input: { yarnId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.yarnId) return fail('bad_input', 'Missing id');

  const { error } = await ctx.supabase.from('yarns').delete().eq('id', input.yarnId);
  if (error) {
    console.error('Yarn delete failed', error);
    return fail('server_error', 'Could not delete');
  }

  return ok({ redirect: '/studio/garn' });
}
