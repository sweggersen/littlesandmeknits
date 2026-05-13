import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { receiveYarn } from '../../../../lib/services/commissions';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await receiveYarn(ctx, { requestId: form.get('request_id')?.toString() ?? '' });
  return toResponse(result, redirect);
};
