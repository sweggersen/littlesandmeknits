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

// ── Address autocomplete ────────────────────────────────────────────────
// One search field: as the user types, Kartverket returns full addresses with
// their postnummer + poststed. We keep the street text (private) + postnummer
// (public) from the chosen hit; the coarse public coords are still derived from
// the POSTNUMMER on save (never the address's own point).

export interface AddressHit {
  /** Street + number, e.g. "Karl Johans gate 1". */
  text: string;
  /** 4-digit postal code. */
  postnummer: string;
  /** City / poststed, title-cased (Kartverket returns it uppercased). */
  poststed: string;
}

/** Norwegian title-case: "OSLO" -> "Oslo", "NORDRE LAND" -> "Nordre Land". */
function titleCaseNo(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s|-)/)
    .map((part) => (part === ' ' || part === '-' ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/** Parse a Kartverket /sok response into address suggestions. Exported so the
 *  parser can be unit-tested against a fixture without a network call. */
export function parseAddressHits(json: unknown): AddressHit[] {
  const arr = (json as { adresser?: unknown })?.adresser;
  if (!Array.isArray(arr)) return [];
  const out: AddressHit[] = [];
  for (const a of arr as Array<Record<string, unknown>>) {
    const text = String(a?.adressetekst ?? '').trim();
    const postnummer = String(a?.postnummer ?? '').replace(/\D/g, '');
    if (!text || postnummer.length !== 4) continue;
    out.push({ text, postnummer, poststed: titleCaseNo(String(a?.poststed ?? '').trim()) });
  }
  return out;
}

/** Autocomplete search against Kartverket. Returns [] for short queries or any
 *  network/parse failure. Never throws. */
export async function searchAddresses(
  query: string,
  opts?: { fetch?: typeof fetch; signal?: AbortSignal; limit?: number },
): Promise<AddressHit[]> {
  const q = (query ?? '').trim();
  if (q.length < 3) return [];
  const doFetch = opts?.fetch ?? fetch;
  const params = new URLSearchParams({
    sok: q,
    treffPerSide: String(opts?.limit ?? 8),
    asciiKompatibel: 'true',
  });
  try {
    const res = await doFetch(`${KARTVERKET_SOK}?${params.toString()}`, {
      headers: { accept: 'application/json' },
      signal: opts?.signal,
    });
    if (!res.ok) return [];
    return parseAddressHits(await res.json());
  } catch {
    return [];
  }
}
