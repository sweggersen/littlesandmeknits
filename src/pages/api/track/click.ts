import type { APIRoute } from 'astro';
import { createServerSupabase } from '../../../lib/supabase';
import { getCurrentUser } from '../../../lib/auth';

const validSources = new Set(['feed', 'search', 'category', 'home']);

// Attributes a click to the most-recent impression for (viewer, listing, source)
// within the last 30 minutes. Anonymous clicks are accepted but unattributed
// (we have no stable session ID yet) — they return 200 to keep the beacon
// fire-and-forget pattern simple.
export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { listing_id?: string; source?: string };
  try {
    body = await request.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const listingId = body.listing_id;
  const source = body.source;
  if (!listingId || !source || !validSources.has(source)) {
    return new Response('Invalid', { status: 400 });
  }

  const user = await getCurrentUser({ request, cookies });
  if (!user) return new Response('ok', { status: 200 });

  const supabase = createServerSupabase({ request, cookies });

  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('listing_impressions')
    .select('id')
    .eq('viewer_id', user.id)
    .eq('listing_id', listingId)
    .eq('source', source)
    .eq('clicked', false)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent?.id) {
    await supabase
      .from('listing_impressions')
      .update({ clicked: true, clicked_at: new Date().toISOString() })
      .eq('id', recent.id);
  }

  return new Response('ok', { status: 200 });
};
