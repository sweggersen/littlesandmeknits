// Listing directory read model for brukt/nytt. Powers the DB sorts (via
// listing-sort) plus the "Nærmest" distance sort, and annotates every row with
// a coarse distance to the buyer when they're located.
//
// A listing's coords live on the PUBLIC listings row (listings.lat/lng — the
// seller's postnummer-area centroid), so this reads through the caller's
// cookie-bound client. The buyer's own coords come from their (private) seller
// profile, which RLS lets them read for themselves.

import type { TypedSupabaseClient } from '../supabase';
import { haversineKm, toRad, type GeoPoint } from '../geocode';
import { listingSortOrders, type ListingSort } from '../listing-sort';

export interface ListingDirContext {
  supabase: TypedSupabaseClient;
  user?: { id: string } | null;
}

export interface ListingFilters {
  search?: string | null;
  category?: string | null;
  prisMin?: number | null;
  prisMax?: number | null;
  ageMin?: number | null;
  ageMax?: number | null;
}

export interface ListingDirInput {
  kind: 'pre_loved' | 'ready_made';
  filters?: ListingFilters;
  sort?: string;
  offset?: number;
  pageSize?: number;
}

export interface DirListing {
  id: string;
  title: string;
  price_nok: number;
  size_label: string;
  hero_photo_path: string | null;
  category: string;
  condition: string | null;
  escrow_enabled: boolean | null;
  can_meet: boolean | null;
  promoted_until: string | null;
  promotion_tier: string | null;
  distanceKm: number | null;
}

export interface ListingDirResult {
  listings: DirListing[];
  hasMore: boolean;
  /** Whether the buyer has coords (drives showing "Nærmest" + distance chips). */
  located: boolean;
}

const DEFAULT_PAGE = 24;
const MAX_PAGE = 48;
const NEAR_CAP = 500;
const NEAR_DEFAULT_KM = 500;
const KNOWN_SORTS = new Set<ListingSort>(['nyeste', 'lagret', 'pris_lav', 'pris_hoy']);

const SELECT =
  'id, title, price_nok, size_label, hero_photo_path, category, condition, escrow_enabled, can_meet, published_at, promoted_until, promotion_tier, favorite_count, lat, lng';

/** The buyer's coarse coords, from their own (private) seller profile. */
export async function buyerListingPoint(ctx: ListingDirContext): Promise<GeoPoint | null> {
  if (!ctx.user) return null;
  const { data } = await ctx.supabase
    .from('seller_profiles').select('lat, lng').eq('id', ctx.user.id).maybeSingle();
  const lat = (data as { lat?: number | null } | null)?.lat;
  const lng = (data as { lng?: number | null } | null)?.lng;
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

function applyFilters(q: any, kind: string, f: ListingFilters) {
  q = q.eq('status', 'active').eq('kind', kind);
  if (f.search) q = q.ilike('title', `%${f.search}%`);
  if (f.category) q = q.eq('category', f.category);
  if (typeof f.prisMin === 'number' && Number.isFinite(f.prisMin)) q = q.gte('price_nok', f.prisMin);
  if (typeof f.prisMax === 'number' && Number.isFinite(f.prisMax)) q = q.lte('price_nok', f.prisMax);
  if (typeof f.ageMin === 'number' && Number.isFinite(f.ageMin)) q = q.gte('size_age_months_max', f.ageMin);
  if (typeof f.ageMax === 'number' && Number.isFinite(f.ageMax)) q = q.lte('size_age_months_min', f.ageMax);
  return q;
}

export async function runListingDirectory(
  ctx: ListingDirContext,
  input: ListingDirInput,
): Promise<ListingDirResult> {
  const pageSize = Math.min(MAX_PAGE, Math.max(1, input.pageSize ?? DEFAULT_PAGE));
  const offset = Math.max(0, input.offset ?? 0);
  const f = input.filters ?? {};

  const point = await buyerListingPoint(ctx);
  const located = !!point;

  // Normalise the sort; "Nærmest" degrades to newest when the buyer isn't located.
  let sort = input.sort ?? 'nyeste';
  if (sort === 'naer' && !located) sort = 'nyeste';
  else if (sort !== 'naer' && !KNOWN_SORTS.has(sort as ListingSort)) sort = 'nyeste';

  const toCard = (r: Record<string, unknown>): DirListing => {
    const lat = r.lat as number | null;
    const lng = r.lng as number | null;
    return {
      id: r.id as string,
      title: r.title as string,
      price_nok: r.price_nok as number,
      size_label: r.size_label as string,
      hero_photo_path: (r.hero_photo_path as string | null) ?? null,
      category: r.category as string,
      condition: (r.condition as string | null) ?? null,
      escrow_enabled: (r.escrow_enabled as boolean | null) ?? null,
      can_meet: (r.can_meet as boolean | null) ?? null,
      promoted_until: (r.promoted_until as string | null) ?? null,
      promotion_tier: (r.promotion_tier as string | null) ?? null,
      distanceKm: point && typeof lat === 'number' && typeof lng === 'number'
        ? haversineKm(point, { lat, lng })
        : null,
    };
  };
  const withDistance = (rows: Record<string, unknown>[]): DirListing[] => rows.map(toCard);

  if (sort === 'naer' && point) {
    // Bounding-box prefilter, then sort by JS haversine and paginate in memory.
    const maxKm = NEAR_DEFAULT_KM;
    const latDelta = maxKm / 111;
    const lngDelta = maxKm / (111 * Math.max(0.1, Math.cos(toRad(point.lat))));
    const { data, error } = await applyFilters(ctx.supabase.from('listings').select(SELECT), input.kind, f)
      .not('lat', 'is', null)
      .gte('lat', point.lat - latDelta).lte('lat', point.lat + latDelta)
      .gte('lng', point.lng - lngDelta).lte('lng', point.lng + lngDelta)
      .limit(NEAR_CAP);
    if (error) return { listings: [], hasMore: false, located };
    const all = withDistance((data ?? []) as Record<string, unknown>[])
      .filter((x) => x.distanceKm != null && (x.distanceKm as number) <= maxKm)
      .sort((a, b) => (a.distanceKm as number) - (b.distanceKm as number));
    const slice = all.slice(offset, offset + pageSize + 1);
    return { listings: slice.slice(0, pageSize), hasMore: slice.length > pageSize, located };
  }

  let q = applyFilters(ctx.supabase.from('listings').select(SELECT), input.kind, f);
  for (const [col, opts] of listingSortOrders(sort as ListingSort)) q = q.order(col, opts);
  const { data, error } = await q.range(offset, offset + pageSize);
  if (error) return { listings: [], hasMore: false, located };
  const rows = (data ?? []) as Record<string, unknown>[];
  return { listings: withDistance(rows.slice(0, pageSize)), hasMore: rows.length > pageSize, located };
}
