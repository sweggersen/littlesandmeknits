import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../lib/services/context';
import { disputeListing } from '../../../../../lib/services/listings';
import { toResponse } from '../../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await disputeListing(ctx, {
    listingId: params.id ?? '',
    reason: form.get('reason')?.toString() ?? '',
  });
  return toResponse(result, redirect);
};
