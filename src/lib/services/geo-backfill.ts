// One-time (self-healing) backfill of coarse coordinates for sellers who became
// sellers before geocoding existed. Runs a small batch per cron tick until every
// seller with a postnummer has coords, then does nothing. Idempotent: only
// touches sellers whose lat is still null. Best-effort: a failed geocode just
// leaves that seller for a later tick.
//
// Each geocoded seller also propagates their coarse point to their listings, so
// the "Nærmest" sort has data for existing inventory.

import type { TypedSupabaseClient } from '../supabase';
import { geocodePostnummer, type GeoPoint } from '../geocode';

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
