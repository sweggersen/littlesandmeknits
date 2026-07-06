// Coarsen a free-text location down to a rough area (city/municipality) so the
// marketplace never surfaces a seller's precise address. Sellers enter location
// as free text (anything from "Bergen" to "Storgata 1, 5003 Bergen"), so this is
// a best-effort privacy guard on the display side.
export function roughLocation(raw?: string | null): string | null {
  let s = (raw ?? '').trim();
  if (!s) return null;
  // "street 1, 5003 Bergen" → keep the last comma-separated part (the area),
  // dropping the street line that precedes it.
  if (s.includes(',')) s = s.split(',').pop()!.trim();
  // Strip a leading Norwegian postal code ("5003 Bergen" → "Bergen").
  s = s.replace(/^\d{4}\s+/, '').trim();
  return s || null;
}
