import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { markPaid } from '../../../../lib/services/payouts';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const result = await markPaid(ctx, { payoutId: form.get('payout_id')?.toString() ?? '' });
  return toResponse(result, redirect);
};
