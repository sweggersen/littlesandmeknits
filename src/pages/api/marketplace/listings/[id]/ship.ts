import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../lib/services/context';
import { shipListing } from '../../../../../lib/services/listings';
import { toResponse } from '../../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await shipListing(ctx, {
    listingId: params.id ?? '',
    trackingCode: form.get('tracking_code')?.toString() ?? '',
  });
  return toResponse(result, redirect);
};
