// SEO-friendly listing URLs.
//
// Old form (still works, 301s to the new one):
//   /market/listing/<uuid>
//
// New form:
//   /market/listing/<slug>-<uuid>
//
// The UUID always lives in the last 36 characters of the path segment,
// so the slug can contain any URL-safe ASCII without ambiguity. The
// slug is purely for SEO + readability; the UUID is the lookup key.

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Lowercase, ASCII-only slug from a Norwegian title.
 *  Converts æøå to ae/o/a, strips diacritics, collapses non-alpha to '-'. */
export function slugifyTitle(input: string): string {
  return input
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60); // cap so URLs stay sane
}

/** Build the canonical pretty URL for a listing.
 *  Falls back to plain /market/listing/<uuid> if title is empty. */
export function listingPath(listing: { id: string; title?: string | null }): string {
  const slug = listing.title ? slugifyTitle(listing.title) : '';
  return slug
    ? `/market/listing/${slug}-${listing.id}`
    : `/market/listing/${listing.id}`;
}

/** Extract the canonical UUID from a route param that's either a bare
 *  UUID or `<slug>-<uuid>`. Returns null if no UUID is found. */
export function extractListingId(param: string | undefined): string | null {
  if (!param) return null;
  const match = param.match(UUID_RE);
  if (!match) return null;
  // Anchor to the END of the param so a slug containing UUID-like
  // sequences can't ever shadow the real id.
  if (!param.endsWith(match[0])) return null;
  return match[0];
}
