// Sort options for the oppdrag (commission requests) directory. Mirrors
// listing-sort.ts so the DirectoryToolbar treats all grids the same.

export type CommissionSort = 'nyeste' | 'utloper' | 'tilbud' | 'budsjett_hoy' | 'budsjett_lav';

export const COMMISSION_SORT_OPTIONS: ReadonlyArray<{ value: CommissionSort; label: string }> = [
  { value: 'nyeste', label: 'Nyeste' },
  { value: 'utloper', label: 'Utløper snart' },
  { value: 'tilbud', label: 'Flest tilbud' },
  { value: 'budsjett_hoy', label: 'Budsjett: høy–lav' },
  { value: 'budsjett_lav', label: 'Budsjett: lav–høy' },
];

export function normalizeCommissionSort(value: string | null | undefined): CommissionSort {
  return COMMISSION_SORT_OPTIONS.some((o) => o.value === value) ? (value as CommissionSort) : 'nyeste';
}

/** Ordered (column, options) pairs to feed successive `.order(...)` calls. */
export function commissionSortOrders(
  sort: CommissionSort,
): ReadonlyArray<readonly [string, { ascending: boolean; nullsFirst?: boolean }]> {
  switch (sort) {
    case 'utloper':
      return [['expires_at', { ascending: true, nullsFirst: false }], ['created_at', { ascending: false }]];
    case 'tilbud':
      return [['offer_count', { ascending: false }], ['created_at', { ascending: false }]];
    case 'budsjett_hoy':
      return [['budget_nok_max', { ascending: false }], ['created_at', { ascending: false }]];
    case 'budsjett_lav':
      return [['budget_nok_min', { ascending: true }], ['created_at', { ascending: false }]];
    case 'nyeste':
    default:
      return [['created_at', { ascending: false }]];
  }
}
