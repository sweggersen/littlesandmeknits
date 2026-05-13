import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { updateYarn } from '../../../../lib/services/yarns';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const photoFile = form.get('photo');
  const result = await updateYarn(ctx, {
    yarnId: params.id ?? '',
    brand: form.get('brand')?.toString() ?? '',
    name: form.get('name')?.toString() ?? '',
    color: form.get('color')?.toString(),
    weight: form.get('weight')?.toString(),
    fiber: form.get('fiber')?.toString(),
    notes: form.get('notes')?.toString(),
    totalGrams: form.get('total_grams')?.toString(),
    totalMeters: form.get('total_meters')?.toString(),
    photo: photoFile instanceof File ? photoFile : null,
  });
  return toResponse(result, redirect);
};
