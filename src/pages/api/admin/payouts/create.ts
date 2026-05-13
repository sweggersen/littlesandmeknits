import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { createPayoutBatch } from '../../../../lib/services/payouts';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Forbidden', { status: 403 });

  const result = await createPayoutBatch(ctx);
  return toResponse(result, redirect);
};
