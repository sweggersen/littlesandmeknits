import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { toggleStoreFavorite } from '../../../lib/services/store-favorites';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const result = await toggleStoreFavorite(ctx, form.get('store_id')?.toString() ?? '');
  return toResponse(result);
};
