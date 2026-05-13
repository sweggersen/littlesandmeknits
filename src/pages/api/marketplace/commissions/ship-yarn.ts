import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { shipYarn } from '../../../../lib/services/commissions';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await shipYarn(ctx, {
    requestId: form.get('request_id')?.toString() ?? '',
    trackingCode: form.get('tracking_code')?.toString(),
  });
  return toResponse(result, redirect);
};
