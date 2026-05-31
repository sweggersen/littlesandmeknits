import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';

const VALID_SOURCES = new Set(['feed', 'search', 'category', 'home']);
const VALID_TIERS = new Set(['boost', 'highlight']);

export type ImpressionRow = {
  listing_id: string;
  position?: number | null;
  promoted?: boolean;
  tier?: 'boost' | 'highlight' | null;
};

/** Record a batch of listing impressions. Anonymous viewers are
 *  supported — viewer_id is null in that case. Uses the cookie-bound
 *  supabase client when available; anon access uses an unauthenticated
 *  client. We take both `ctx` and an optional `anonClient` to handle
 *  the not-signed-in case cleanly. */
export async function recordImpressions(
  input: {
    source: string;
    rows: ImpressionRow[];
    viewerId: string | null;
    client: SupabaseClient;
  },
): Promise<ServiceResult<void>> {
  if (!VALID_SOURCES.has(input.source)) return fail('bad_input', 'Invalid source');
  if (input.rows.length === 0 || input.rows.length > 50) return fail('bad_input', 'Invalid rows');

  const inserts = input.rows
    .filter((r) => typeof r.listing_id === 'string' && r.listing_id.length > 0)
    .map((r) => ({
      listing_id: r.listing_id,
      viewer_id: input.viewerId,
      source: input.source,
      promoted: r.promoted === true,
      tier: r.tier && VALID_TIERS.has(r.tier) ? r.tier : null,
      position: typeof r.position === 'number' && r.position > 0 ? Math.min(r.position, 32767) : null,
      clicked: false,
    }));

  if (inserts.length === 0) return fail('bad_input', 'Invalid rows');

  const { error } = await input.client.from('listing_impressions').insert(inserts);
  if (error) return fail('server_error', error.message);
  return ok(undefined);
}

/** Attribute a click to the most recent matching impression within the
 *  last 30 minutes. Anonymous clicks are silently accepted. */
export async function recordClick(
  ctx: ServiceContext,
  input: { listingId: string; source: string },
): Promise<ServiceResult<void>> {
  if (!input.listingId) return fail('bad_input', 'Missing listing_id');
  if (!VALID_SOURCES.has(input.source)) return fail('bad_input', 'Invalid source');

  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: recent } = await ctx.supabase
    .from('listing_impressions')
    .select('id')
    .eq('viewer_id', ctx.user.id)
    .eq('listing_id', input.listingId)
    .eq('source', input.source)
    .eq('clicked', false)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent?.id) {
    await ctx.supabase
      .from('listing_impressions')
      .update({ clicked: true, clicked_at: new Date().toISOString() })
      .eq('id', recent.id);
  }
  return ok(undefined);
}
