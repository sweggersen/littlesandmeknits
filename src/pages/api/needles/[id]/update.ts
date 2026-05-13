import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { updateNeedle } from '../../../../lib/services/needles';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await updateNeedle(ctx, {
    needleId: params.id ?? '',
    needleType: form.get('needle_type')?.toString() ?? '',
    sizeMm: form.get('size_mm')?.toString() ?? '',
    lengthCm: form.get('length_cm')?.toString(),
    material: form.get('material')?.toString(),
    brand: form.get('brand')?.toString(),
    notes: form.get('notes')?.toString(),
  });
  return toResponse(result, redirect);
};
