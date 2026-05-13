import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { createRequest } from '../../../../lib/services/commissions';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn?next=/marked/oppdrag/ny');

  const form = await request.formData();
  const result = await createRequest(ctx, {
    title: form.get('title')?.toString() ?? '',
    category: form.get('category')?.toString() ?? '',
    sizeLabel: form.get('size_label')?.toString() ?? '',
    budgetNokMin: form.get('budget_nok_min')?.toString() ?? '',
    budgetNokMax: form.get('budget_nok_max')?.toString() ?? '',
    description: form.get('description')?.toString(),
    colorway: form.get('colorway')?.toString(),
    patternExternalTitle: form.get('pattern_external_title')?.toString(),
    yarnPreference: form.get('yarn_preference')?.toString(),
    yarnProvidedByBuyer: form.get('yarn_provided_by_buyer') === '1',
    neededBy: form.get('needed_by')?.toString(),
    sizeAgeMonthsMin: form.get('size_age_months_min')?.toString(),
    sizeAgeMonthsMax: form.get('size_age_months_max')?.toString(),
    targetKnitterId: form.get('target_knitter_id')?.toString(),
  });
  return toResponse(result, redirect);
};
