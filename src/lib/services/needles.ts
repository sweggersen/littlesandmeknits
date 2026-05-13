import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

const VALID_TYPES = new Set(['circular', 'dpn', 'straight']);

const toFloatOrNull = (v: string | undefined | null): number | null => {
  if (!v) return null;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const toIntOrNull = (v: string | undefined | null): number | null => {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function createNeedle(
  ctx: ServiceContext,
  input: {
    needleType: string; sizeMm: string; lengthCm?: string;
    material?: string; brand?: string; notes?: string;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!VALID_TYPES.has(input.needleType)) return fail('bad_input', 'Invalid type');
  const sizeMm = toFloatOrNull(input.sizeMm);
  if (sizeMm === null) return fail('bad_input', 'Size required');

  const { data, error } = await ctx.supabase
    .from('needles')
    .insert({
      user_id: ctx.user.id,
      needle_type: input.needleType,
      size_mm: sizeMm,
      length_cm: toIntOrNull(input.lengthCm),
      material: input.material?.trim() || null,
      brand: input.brand?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('Needle create failed', error);
    return fail('server_error', 'Could not create needle');
  }

  return ok({ redirect: '/studio/pinner' });
}

export async function updateNeedle(
  ctx: ServiceContext,
  input: {
    needleId: string; needleType: string; sizeMm: string; lengthCm?: string;
    material?: string; brand?: string; notes?: string;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.needleId) return fail('bad_input', 'Missing id');
  if (!VALID_TYPES.has(input.needleType)) return fail('bad_input', 'Invalid type');
  const sizeMm = toFloatOrNull(input.sizeMm);
  if (sizeMm === null) return fail('bad_input', 'Size required');

  const { error } = await ctx.supabase
    .from('needles')
    .update({
      needle_type: input.needleType,
      size_mm: sizeMm,
      length_cm: toIntOrNull(input.lengthCm),
      material: input.material?.trim() || null,
      brand: input.brand?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .eq('id', input.needleId);

  if (error) {
    console.error('Needle update failed', error);
    return fail('server_error', 'Could not update needle');
  }

  return ok({ redirect: `/studio/pinner/${input.needleId}` });
}

export async function deleteNeedle(
  ctx: ServiceContext,
  input: { needleId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.needleId) return fail('bad_input', 'Missing id');

  const { error } = await ctx.supabase.from('needles').delete().eq('id', input.needleId);
  if (error) {
    console.error('Needle delete failed', error);
    return fail('server_error', 'Could not delete needle');
  }

  return ok({ redirect: '/studio/pinner' });
}
