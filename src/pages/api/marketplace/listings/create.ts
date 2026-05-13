import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { createListing } from '../../../../lib/services/listings';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn?next=/marked/listing/ny');

  const form = await request.formData();
  const result = await createListing(ctx, {
    kind: form.get('kind')?.toString() ?? '',
    title: form.get('title')?.toString() ?? '',
    category: form.get('category')?.toString() ?? '',
    sizeLabel: form.get('size_label')?.toString() ?? '',
    priceNok: form.get('price_nok')?.toString() ?? '',
    condition: form.get('condition')?.toString(),
    description: form.get('description')?.toString(),
    colorway: form.get('colorway')?.toString(),
    patternSlug: form.get('pattern_slug')?.toString(),
    patternExternalTitle: form.get('pattern_external_title')?.toString(),
    sizeAgeMonthsMin: form.get('size_age_months_min')?.toString(),
    sizeAgeMonthsMax: form.get('size_age_months_max')?.toString(),
    location: form.get('location')?.toString(),
    shippingInfo: form.get('shipping_info')?.toString(),
  });
  return toResponse(result, redirect);
};
