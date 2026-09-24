import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { payCommission } from '../../../../lib/services/commissions';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/login');

  const form = await request.formData();
  const requestId = form.get('request_id')?.toString() ?? '';
  const result = await payCommission(ctx, { requestId });
  // Full-page form: a failure returns to the commission with the message in the
  // global error toast rather than a bare error page.
  return toResponse(result, redirect, { errorRedirect: `/market/commissions/${requestId}` });
};
