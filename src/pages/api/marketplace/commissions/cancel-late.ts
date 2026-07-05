import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { cancelLateCommission } from '../../../../lib/services/commissions';
import { toResponse } from '../../../../lib/services/response';

// P1.1: buyer cancels a paid, overdue, in-progress commission and gets refunded.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/login');

  const form = await request.formData();
  const result = await cancelLateCommission(ctx, {
    requestId: form.get('request_id')?.toString() ?? '',
  });
  return toResponse(result, redirect);
};
