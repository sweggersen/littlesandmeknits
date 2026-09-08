// Store directory read model. Powers /market/stores: a filterable, sortable,
// paginated grid plus a personalised "Anbefalte butikker" strip.
//
// Reads only, and everything goes through the caller's cookie-bound client so
// RLS is the gate: the buyer self-reads their own store_favorites, seller
// coords, and orders. No admin client here — this runs in a page module for
// anon and authed visitors alike.

import type { TypedSupabaseClient } from '../supabase';
import type { ServiceResult } from './types';
import { ok } from './types';
import { haversineKm, toRad, type GeoPoint } from '../geocode';

export type StoreSort = 'anbefalt' | 'nyeste' | 'rating' | 'aktive' | 'naer';
const SORTS = new Set<StoreSort>(['anbefalt', 'nyeste', 'rating', 'aktive', 'naer']);

export interface DirectoryContext {
  supabase: TypedSupabaseClient;
  user?: { id: string } | null;
}

export interface StoreCardData {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  logo_path: string | null;
  location_city: string | null;
  postnummer: string | null;
  verified: boolean;
  featured: boolean;
  rating_avg: number;
  rating_count: number;
  active_listing_count: number;
  last_listing_at: string | null;
  favorite_count: number;
  isFavorite: boolean;
  hasNewSinceSeen: boolean;
  /** Coarse km to the buyer's postnummer centroid; null when not located. */
  distanceKm: number | null;
}

export interface StoreFilters {
  city?: string | null;
  minRating?: number | null;
  hasActiveListings?: boolean | null;
  maxDistanceKm?: number | null;
}

export interface ListStoresInput {
  filters?: StoreFilters;
  sort?: StoreSort;
  cursor?: string | null;
  pageSize?: number;
}

export interface ListStoresResult {
  recommended: StoreCardData[];
  results: StoreCardData[];
  nextCursor: string | null;
  /** Whether the buyer has coordinates (drives showing "Nærmest" + distance). */
  located: boolean;
  sort: StoreSort;
}

const DEFAULT_PAGE = 24;
const MAX_PAGE = 48;
const NEAR_CANDIDATE_CAP = 500; // bounding-box fetch ceiling for the JS distance sort
const NEAR_DEFAULT_KM = 500;
const RECOMMENDED_CAP = 6;

const CARD_COLUMNS =
  'id, slug, name, tagline, logo_path, location_city, postnummer, verified, featured, featured_rank, rating_avg, rating_count, active_listing_count, last_listing_at, favorite_count, created_at, lat, lng';

type RawRow = Record<string, unknown>;

/** Base query: publicly visible stores, card columns, filters applied. */
function baseQuery(ctx: DirectoryContext, filters: StoreFilters) {
  let q = ctx.supabase
    .from('stores')
    .select(CARD_COLUMNS)
    .eq('status', 'active')
    .is('deleted_at', null);

  if (filters.city && filters.city.trim()) q = q.ilike('location_city', `%${filters.city.trim()}%`);
  if (typeof filters.minRating === 'number' && filters.minRating > 0) q = q.gte('rating_avg', filters.minRating);
  if (filters.hasActiveListings) q = q.gt('active_listing_count', 0);
  return q;
}

/** The buyer's coarse coordinates, from their (private) seller profile. */
async function buyerPoint(ctx: DirectoryContext): Promise<GeoPoint | null> {
  if (!ctx.user) return null;
  const { data } = await ctx.supabase
    .from('seller_profiles')
    .select('lat, lng')
    .eq('id', ctx.user.id)
    .maybeSingle();
  const lat = (data as { lat?: number | null } | null)?.lat;
  const lng = (data as { lng?: number | null } | null)?.lng;
  if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  return null;
}

/** For a set of store ids, which the current user has favourited + when they
 *  last saw each (to diff against last_listing_at for the "new" dot). */
async function favMap(ctx: DirectoryContext, storeIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ctx.user || storeIds.length === 0) return map;
  const { data } = await ctx.supabase
    .from('store_favorites')
    .select('store_id, last_seen_at')
    .eq('user_id', ctx.user.id)
    .in('store_id', storeIds);
  for (const r of (data ?? []) as Array<{ store_id: string; last_seen_at: string }>) {
    map.set(r.store_id, r.last_seen_at);
  }
  return map;
}

function toCard(row: RawRow, favs: Map<string, string>, point: GeoPoint | null): StoreCardData {
  const id = row.id as string;
  const lastListing = (row.last_listing_at as string | null) ?? null;
  const lastSeen = favs.get(id) ?? null;
  const isFavorite = favs.has(id);
  const hasNewSinceSeen =
    isFavorite && !!lastListing && !!lastSeen && new Date(lastListing) > new Date(lastSeen);

  let distanceKm: number | null = null;
  const lat = row.lat as number | null;
  const lng = row.lng as number | null;
  if (point && typeof lat === 'number' && typeof lng === 'number') {
    distanceKm = haversineKm(point, { lat, lng });
  }

  return {
    id,
    slug: row.slug as string,
    name: row.name as string,
    tagline: (row.tagline as string | null) ?? null,
    logo_path: (row.logo_path as string | null) ?? null,
    location_city: (row.location_city as string | null) ?? null,
    postnummer: (row.postnummer as string | null) ?? null,
    verified: !!row.verified,
    featured: !!row.featured,
    rating_avg: Number(row.rating_avg ?? 0),
    rating_count: Number(row.rating_count ?? 0),
    active_listing_count: Number(row.active_listing_count ?? 0),
    last_listing_at: lastListing,
    favorite_count: Number(row.favorite_count ?? 0),
    isFavorite,
    hasNewSinceSeen,
    distanceKm,
  };
}

function parseCursor(cursor: string | null | undefined): number {
  const n = parseInt(cursor ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Distinct cities across publicly visible stores, for the directory's "By"
 *  autosuggest. Independent of the active filters so the full list is always
 *  offered. Deduped + sorted; empty on error. */
export async function listStoreCities(ctx: DirectoryContext): Promise<string[]> {
  const { data } = await ctx.supabase
    .from('stores')
    .select('location_city')
    .eq('status', 'active')
    .is('deleted_at', null)
    .not('location_city', 'is', null)
    .limit(2000);
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{ location_city: string | null }>) {
    const c = r.location_city?.trim();
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'nb'));
}

export async function listStores(
  ctx: DirectoryContext,
  input: ListStoresInput,
): Promise<ServiceResult<ListStoresResult>> {
  const requestedSort: StoreSort = SORTS.has(input.sort as StoreSort) ? (input.sort as StoreSort) : 'anbefalt';
  const pageSize = Math.min(MAX_PAGE, Math.max(1, input.pageSize ?? DEFAULT_PAGE));
  const offset = parseCursor(input.cursor);
  const filters = input.filters ?? {};

  const point = await buyerPoint(ctx);
  const located = !!point;
  // "Nærmest" needs buyer coords; degrade to the default sort when absent.
  const sort: StoreSort = requestedSort === 'naer' && !located ? 'anbefalt' : requestedSort;

  let pageRows: RawRow[];
  let nextCursor: string | null;

  if (sort === 'naer' && point) {
    // Bounding-box prefilter, then sort by JS haversine and paginate in memory.
    // Coarse (postnummer-centroid) coords => this can't reveal a home address.
    const maxKm = filters.maxDistanceKm && filters.maxDistanceKm > 0 ? filters.maxDistanceKm : NEAR_DEFAULT_KM;
    const latDelta = maxKm / 111;
    const lngDelta = maxKm / (111 * Math.max(0.1, Math.cos(toRad(point.lat))));
    const { data, error } = await baseQuery(ctx, filters)
      .not('lat', 'is', null)
      .gte('lat', point.lat - latDelta)
      .lte('lat', point.lat + latDelta)
      .gte('lng', point.lng - lngDelta)
      .lte('lng', point.lng + lngDelta)
      .limit(NEAR_CANDIDATE_CAP);
    if (error) return failList(error);

    const withDist = ((data ?? []) as RawRow[])
      .map((r) => ({ r, d: haversineKm(point, { lat: r.lat as number, lng: r.lng as number }) }))
      .filter((x) => x.d <= maxKm)
      .sort((a, b) => a.d - b.d);
    const slice = withDist.slice(offset, offset + pageSize + 1);
    const hasMore = slice.length > pageSize;
    pageRows = slice.slice(0, pageSize).map((x) => x.r);
    nextCursor = hasMore ? String(offset + pageSize) : null;
  } else {
    let q = baseQuery(ctx, filters);
    q = applySort(q, sort);
    const { data, error } = await q.range(offset, offset + pageSize); // fetch one extra
    if (error) return failList(error);
    const rows = (data ?? []) as RawRow[];
    const hasMore = rows.length > pageSize;
    pageRows = rows.slice(0, pageSize);
    nextCursor = hasMore ? String(offset + pageSize) : null;
  }

  // Recommended strip only on the first page.
  const recommendedRows = offset === 0 ? await recommendedRowsFor(ctx, filters, pageRows) : [];

  const allIds = [...pageRows, ...recommendedRows].map((r) => r.id as string);
  const favs = await favMap(ctx, allIds);

  return ok({
    recommended: recommendedRows.map((r) => toCard(r, favs, point)),
    results: pageRows.map((r) => toCard(r, favs, point)),
    nextCursor,
    located,
    sort,
  });
}

function applySort<Q extends { order: (col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) => Q }>(
  q: Q,
  sort: StoreSort,
): Q {
  switch (sort) {
    case 'nyeste':
      return q.order('created_at', { ascending: false });
    case 'rating':
      return q.order('rating_avg', { ascending: false }).order('rating_count', { ascending: false });
    case 'aktive':
      return q.order('last_listing_at', { ascending: false, nullsFirst: false });
    case 'anbefalt':
    default:
      return q
        .order('featured', { ascending: false })
        .order('featured_rank', { ascending: false })
        .order('verified', { ascending: false })
        .order('rating_avg', { ascending: false })
        .order('created_at', { ascending: false });
  }
}

/** The "Anbefalte butikker" strip: admin-featured first, then a personalised
 *  fill (favourited-with-new-listings, then bought-from), then a top-rated
 *  verified fill for anon or short lists. Capped, deduped against the first
 *  page of results. */
async function recommendedRowsFor(
  ctx: DirectoryContext,
  filters: StoreFilters,
  pageRows: RawRow[],
): Promise<RawRow[]> {
  const exclude = new Set(pageRows.map((r) => r.id as string));
  const picked = new Map<string, RawRow>();
  const take = (rows: RawRow[] | null | undefined) => {
    for (const r of rows ?? []) {
      const id = r.id as string;
      if (picked.size >= RECOMMENDED_CAP) break;
      if (exclude.has(id) || picked.has(id)) continue;
      picked.set(id, r);
    }
  };

  // 1. Admin-featured partners.
  const { data: featured } = await baseQuery(ctx, filters)
    .eq('featured', true)
    .order('featured_rank', { ascending: false })
    .limit(RECOMMENDED_CAP);
  take(featured as RawRow[] | null);

  // 2. Personalised: favourited stores with new listings, then bought-from.
  if (ctx.user && picked.size < RECOMMENDED_CAP) {
    const [{ data: favRows }, { data: orderRows }] = await Promise.all([
      ctx.supabase.from('store_favorites').select('store_id, last_seen_at').eq('user_id', ctx.user.id),
      // buyer self-read (orders_buyer_read RLS) — the user's own purchase history.
      ctx.supabase.from('orders').select('store_id').eq('buyer_id', ctx.user.id).not('store_id', 'is', null),
    ]);
    const personalIds = new Set<string>();
    for (const f of (favRows ?? []) as Array<{ store_id: string }>) personalIds.add(f.store_id);
    for (const o of (orderRows ?? []) as Array<{ store_id: string }>) personalIds.add(o.store_id);
    const ids = [...personalIds].filter((id) => !exclude.has(id) && !picked.has(id));
    if (ids.length > 0) {
      const { data: stores } = await baseQuery(ctx, filters)
        .in('id', ids)
        .order('last_listing_at', { ascending: false, nullsFirst: false })
        .limit(RECOMMENDED_CAP);
      take(stores as RawRow[] | null);
    }
  }

  // 3. Fill: top-rated verified stores (also the whole strip for anon).
  if (picked.size < RECOMMENDED_CAP) {
    const { data: fill } = await baseQuery(ctx, filters)
      .order('verified', { ascending: false })
      .order('rating_avg', { ascending: false })
      .order('rating_count', { ascending: false })
      .limit(RECOMMENDED_CAP * 3);
    take(fill as RawRow[] | null);
  }

  return [...picked.values()];
}

function failList(error: unknown): ServiceResult<ListStoresResult> {
  console.error('listStores query failed', error);
  // A read failure returns an empty directory rather than a hard error page.
  return ok({ recommended: [], results: [], nextCursor: null, located: false, sort: 'anbefalt' });
}
