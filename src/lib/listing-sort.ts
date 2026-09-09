// Sort options for the brukt/nytt listing directories. Shared so both pages
// (and any future listing grid) offer the same set and ordering.
//
// "Nyeste" keeps promoted listings first (a paid boost that should always
// surface), then newest. The explicit price/popularity sorts are strict — a
// price sort shouldn't be reshuffled by promotions — with newest as the
// tie-breaker.
//
// Nærmest (distance) is intentionally absent until listings carry location:
// a listing's location is its seller's, and sellers aren't geocoded yet.

export type ListingSort = 'nyeste' | 'lagret' | 'pris_lav' | 'pris_hoy';

export const LISTING_SORT_OPTIONS: ReadonlyArray<{ value: ListingSort; label: string }> = [
  { value: 'nyeste', label: 'Nyeste' },
  { value: 'lagret', label: 'Mest lagret' },
  { value: 'pris_lav', label: 'Pris: lav–høy' },
  { value: 'pris_hoy', label: 'Pris: høy–lav' },
];

export function normalizeListingSort(value: string | null | undefined): ListingSort {
  return LISTING_SORT_OPTIONS.some((o) => o.value === value) ? (value as ListingSort) : 'nyeste';
}

/** The ordered list of (column, options) to feed into successive `.order(...)`
 *  calls on a Supabase listings query. */
export function listingSortOrders(
  sort: ListingSort,
): ReadonlyArray<readonly [string, { ascending: boolean; nullsFirst?: boolean }]> {
  switch (sort) {
    case 'pris_lav':
      return [['price_nok', { ascending: true }], ['published_at', { ascending: false }]];
    case 'pris_hoy':
      return [['price_nok', { ascending: false }], ['published_at', { ascending: false }]];
    case 'lagret':
      return [['favorite_count', { ascending: false }], ['published_at', { ascending: false }]];
    case 'nyeste':
    default:
      return [['promoted_until', { ascending: false, nullsFirst: false }], ['published_at', { ascending: false }]];
  }
}
