import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { getDownloadUrl } from '../../../lib/services/checkout';

export const GET: APIRoute = async ({ params, request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const result = await getDownloadUrl(ctx, { purchaseId: params.id ?? '' });
  if (!result.ok) return new Response(result.message, { status: result.code === 'forbidden' ? 403 : result.code === 'not_found' ? 404 : 500 });
  return Response.redirect(result.data.signedUrl, 302);
};
