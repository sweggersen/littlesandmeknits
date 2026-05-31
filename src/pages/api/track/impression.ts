import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { createServerSupabase } from '../../../lib/supabase';
import { recordImpressions, type ImpressionRow } from '../../../lib/services/tracking';

// Impression tracking accepts anonymous viewers, so we don't use
// buildServiceContext (which requires a user). The service helper takes
// an explicit client + viewer id.
export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { source?: string; rows?: ImpressionRow[]; listing_ids?: string[]; promoted?: string[] };
  try {
    body = await request.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  // New shape: rows[]. Legacy shape: listing_ids[] + promoted[].
  let rows: ImpressionRow[] = [];
  if (Array.isArray(body.rows)) {
    rows = body.rows;
  } else if (Array.isArray(body.listing_ids)) {
    const promotedSet = new Set(body.promoted ?? []);
    rows = body.listing_ids.map((id) => ({
      listing_id: id,
      promoted: promotedSet.has(id),
    }));
  }

  const user = await getCurrentUser({ request, cookies });
  const supabase = createServerSupabase({ request, cookies });

  const result = await recordImpressions({
    source: body.source ?? '',
    rows,
    viewerId: user?.id ?? null,
    client: supabase,
  });
  if (!result.ok) return new Response(result.message, { status: 400 });
  return new Response('ok', { status: 200 });
};
