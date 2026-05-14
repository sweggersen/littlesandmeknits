import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { toggleFavorite } from '../../../lib/services/favorites';

export const POST: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const result = await toggleFavorite(ctx, {
    itemType: form.get('item_type')?.toString() ?? '',
    itemId: form.get('item_id')?.toString() ?? '',
  });

  if (!result.ok) return new Response(result.message, { status: 400 });
  return Response.json(result.data);
};
