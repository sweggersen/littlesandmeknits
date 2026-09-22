// One-time (self-healing) backfill of coarse coordinates for sellers who became
// sellers before geocoding existed. Runs a small batch per cron tick until every
// seller with a postnummer has coords, then does nothing. Idempotent: only
// touches sellers whose lat is still null. Best-effort: a failed geocode just
// leaves that seller for a later tick.
//
// Each geocoded seller also propagates their coarse point to their listings, so
// the "Nærmest" sort has data for existing inventory.

import type { TypedSupabaseClient } from '../supabase';
import { geocodePostnummer, geocodeAddress, composeStoreAddressQuery, type GeoPoint } from '../geocode';

export async function backfillSellerGeocode(
  admin: TypedSupabaseClient,
  opts: { limit?: number } = {},
): Promise<{ sellersGeocoded: number; scanned: number }> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 25));

  const { data: sellers } = await admin
    .from('seller_profiles')
    .select('id, postal_code, city')
    .not('postal_code', 'is', null)
    .is('lat', null)
    .limit(limit);

  const rows = (sellers ?? []) as Array<{ id: string; postal_code: string | null; city: string | null }>;
  let sellersGeocoded = 0;
  // Cache by postnummer so a batch of same-town sellers is one Kartverket call.
  const cache = new Map<string, GeoPoint | null>();

  for (const s of rows) {
    const pn = String(s.postal_code ?? '').replace(/\D/g, '');
    if (pn.length !== 4) continue;
    if (!cache.has(pn)) cache.set(pn, await geocodePostnummer(pn, s.city));
    const point = cache.get(pn) ?? null;
    if (!point) continue;

    const now = new Date().toISOString();
    await admin.from('seller_profiles')
      .update({ lat: point.lat, lng: point.lng, geocoded_at: now } as never)
      .eq('id', s.id);
    // Propagate to this seller's listings (their coarse location = the seller's).
    await admin.from('listings')
      .update({ lat: point.lat, lng: point.lng, geocoded_at: now } as never)
      .eq('seller_id', s.id);
    sellersGeocoded++;
  }

  return { sellersGeocoded, scanned: rows.length };
}

/** Self-healing backfill of EXACT store coordinates. A store is a business, so
 *  its location is public — we geocode the full street address (unlike a seller,
 *  who stays coarse). Targets stores that predate the exact-address pipeline (or
 *  whose exact geocode failed at create time): `geocode_precision is null`.
 *  Upgrades each to the address point ('exact') or, if the address doesn't
 *  resolve, records the postnummer centroid ('coarse') so it isn't retried
 *  forever. Sets a precision on every processed row, so a batch per cron tick
 *  drains the backlog and then no-ops. Idempotent + best-effort. */
export async function backfillStoreGeocode(
  admin: TypedSupabaseClient,
  opts: { limit?: number } = {},
): Promise<{ storesGeocoded: number; scanned: number }> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 25));

  // Only active, non-deleted stores that haven't been through the exact geocoder
  // yet. Embed the private street address; fall back to the public legal address.
  // admin (service_role) bypasses store_private_details' members-only RLS.
  const { data: stores } = await admin
    .from('stores')
    .select('id, postnummer, location_city, legal_address, store_private_details(precise_address)')
    .eq('status', 'active')
    .is('deleted_at', null)
    .is('geocode_precision', null)
    .limit(limit);

  const rows = (stores ?? []) as Array<{
    id: string;
    postnummer: string | null;
    location_city: string | null;
    legal_address: string | null;
    store_private_details: { precise_address: string | null } | { precise_address: string | null }[] | null;
  }>;

  let storesGeocoded = 0;
  for (const s of rows) {
    const pn = String(s.postnummer ?? '').replace(/\D/g, '');
    if (pn.length !== 4) continue; // can't geocode without a postal code; leave for a manual fix
    // The embed can come back as an object or a single-element array.
    const pd = Array.isArray(s.store_private_details) ? s.store_private_details[0] : s.store_private_details;
    const address = (pd?.precise_address ?? s.legal_address ?? '').trim();

    let point: GeoPoint | null = address
      ? await geocodeAddress(composeStoreAddressQuery(address, pn, s.location_city))
      : null;
    let precision: 'exact' | 'coarse' = 'exact';
    if (!point) {
      point = await geocodePostnummer(pn, s.location_city);
      precision = 'coarse';
    }
    if (!point) continue; // both failed (bad postnummer) — retry on a later tick

    await admin.from('stores')
      .update({ lat: point.lat, lng: point.lng, geocoded_at: new Date().toISOString(), geocode_precision: precision } as never)
      .eq('id', s.id);
    storesGeocoded++;
  }

  return { storesGeocoded, scanned: rows.length };
}
