import type { APIRoute } from 'astro';
import { createServerSupabase } from '../../../lib/supabase';
import { getCurrentUser } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { listing_ids: string[]; source: string; promoted: string[] };
  try {
    body = await request.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const { listing_ids, source, promoted = [] } = body;
  if (!Array.isArray(listing_ids) || listing_ids.length === 0 || listing_ids.length > 50) {
    return new Response('Invalid listing_ids', { status: 400 });
  }

  const validSources = ['feed', 'search', 'category', 'home'];
  if (!validSources.includes(source)) {
    return new Response('Invalid source', { status: 400 });
  }

  const user = await getCurrentUser({ request, cookies });
  const supabase = createServerSupabase({ request, cookies });
  const promotedSet = new Set(promoted);

  const rows = listing_ids.map((id) => ({
    listing_id: id,
    viewer_id: user?.id ?? null,
    source,
    promoted: promotedSet.has(id),
    clicked: false,
  }));

  await supabase.from('listing_impressions').insert(rows);

  return new Response('ok', { status: 200 });
};
