import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { makeOffer } from '../../../../lib/services/commissions';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await makeOffer(ctx, {
    requestId: form.get('request_id')?.toString() ?? '',
    priceNok: form.get('price_nok')?.toString() ?? '',
    turnaroundWeeks: form.get('turnaround_weeks')?.toString() ?? '',
    message: form.get('message')?.toString() ?? '',
  });
  return toResponse(result, redirect);
};
