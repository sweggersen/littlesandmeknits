import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../../lib/services/context';
import { respondToRefund } from '../../../../../lib/services/refunds';
import { toResponse } from '../../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Forbidden', { status: 403 });
  const form = await request.formData();
  const result = await respondToRefund(ctx, {
    listingId: params.id ?? '',
    action: form.get('action')?.toString() ?? '',
    notes: form.get('notes')?.toString(),
  });
  return toResponse(result, redirect);
};
