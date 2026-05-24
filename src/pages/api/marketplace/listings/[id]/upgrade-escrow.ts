import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../lib/services/context';
import { toggleListingEscrow } from '../../../../../lib/services/listings';
import { toResponse } from '../../../../../lib/services/response';

// TB is now free for sellers — this endpoint just flips the
// escrow_enabled flag. Endpoint path kept stable for existing forms.
export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/login');

  const form = await request.formData();
  const enabled = form.get('enabled')?.toString() !== 'false';

  const result = await toggleListingEscrow(ctx, {
    listingId: params.id ?? '',
    enabled,
  });
  return toResponse(result, redirect);
};
