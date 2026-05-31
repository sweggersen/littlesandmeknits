import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { recordClick } from '../../../lib/services/tracking';

// Click attribution is opt-in for signed-in users. Anonymous clicks
// return 200 silently (the beacon is fire-and-forget; we have no
// stable anon session).
export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { listing_id?: string; source?: string };
  try {
    body = await request.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('ok', { status: 200 });

  const result = await recordClick(ctx, {
    listingId: body.listing_id ?? '',
    source: body.source ?? '',
  });
  if (!result.ok) return new Response(result.message, { status: 400 });
  return new Response('ok', { status: 200 });
};
