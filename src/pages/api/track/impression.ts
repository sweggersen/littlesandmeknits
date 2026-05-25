import type { APIRoute } from 'astro';
import { createServerSupabase } from '../../../lib/supabase';
import { getCurrentUser } from '../../../lib/auth';

type ImpressionRow = {
  listing_id: string;
  position?: number | null;
  promoted?: boolean;
  tier?: 'boost' | 'highlight' | null;
};

const validSources = new Set(['feed', 'search', 'category', 'home']);
const validTiers = new Set(['boost', 'highlight']);

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { source: string; rows?: ImpressionRow[]; listing_ids?: string[]; promoted?: string[] };
  try {
    body = await request.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  if (!validSources.has(body.source)) {
    return new Response('Invalid source', { status: 400 });
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

  if (rows.length === 0 || rows.length > 50) {
    return new Response('Invalid rows', { status: 400 });
  }

  const user = await getCurrentUser({ request, cookies });
  const supabase = createServerSupabase({ request, cookies });

  const inserts = rows
    .filter((r) => typeof r.listing_id === 'string' && r.listing_id.length > 0)
    .map((r) => ({
      listing_id: r.listing_id,
      viewer_id: user?.id ?? null,
      source: body.source,
      promoted: r.promoted === true,
      tier: r.tier && validTiers.has(r.tier) ? r.tier : null,
      position: typeof r.position === 'number' && r.position > 0 ? Math.min(r.position, 32767) : null,
      clicked: false,
    }));

  if (inserts.length === 0) return new Response('Invalid rows', { status: 400 });

  await supabase.from('listing_impressions').insert(inserts);

  return new Response('ok', { status: 200 });
};
