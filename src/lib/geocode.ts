// Coarse geocoding via Kartverket (Geonorge) — free, official, no API key.
//
// We deliberately resolve the POSTNUMMER area centroid ONLY, never a street
// address. The resulting coordinate is coarse by design: good enough for a
// distance sort and a city-level map marker, but it cannot reveal a home. The
// store's exact address (store_private_details.precise_address) is never passed
// here — it exists purely as a private fraud/verification signal.

export interface GeoPoint {
  lat: number;
  lng: number;
}

const KARTVERKET_SOK = 'https://ws.geonorge.no/adresser/v1/sok';

/** Resolve a Norwegian postal code to a coarse area centroid. Returns null on
 *  an empty/invalid postnummer, no hit, or any network/parse failure — the
 *  caller decides whether to dead-letter and retry. Never throws. */
export async function geocodePostnummer(
  postnummer: string | null | undefined,
  poststed?: string | null,
  opts?: { fetch?: typeof fetch; signal?: AbortSignal },
): Promise<GeoPoint | null> {
  const pn = (postnummer ?? '').replace(/\D/g, '');
  if (pn.length !== 4) return null;

  const doFetch = opts?.fetch ?? fetch;
  const params = new URLSearchParams({
    postnummer: pn,
    treffPerSide: '1',
    asciiKompatibel: 'true',
  });
  if (poststed && poststed.trim()) params.set('poststed', poststed.trim());

  let json: unknown;
  try {
    const res = await doFetch(`${KARTVERKET_SOK}?${params.toString()}`, {
      headers: { accept: 'application/json' },
      signal: opts?.signal,
    });
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }
  return parseKartverketPoint(json);
}

/** Pull the first representasjonspunkt out of a Kartverket /sok response.
 *  Exported so the parser can be unit-tested against a fixture without a
 *  network call. */
export function parseKartverketPoint(json: unknown): GeoPoint | null {
  const adresser = (json as { adresser?: unknown })?.adresser;
  if (!Array.isArray(adresser) || adresser.length === 0) return null;
  const p = (adresser[0] as { representasjonspunkt?: { lat?: unknown; lon?: unknown } })?.representasjonspunkt;
  const lat = Number(p?.lat);
  const lng = Number(p?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Great-circle distance in kilometres between two coarse points. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371; // mean earth radius, km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
