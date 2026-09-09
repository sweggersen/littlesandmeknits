import { describe, it, expect, vi } from 'vitest';

vi.mock('../geocode', () => ({
  geocodePostnummer: vi.fn(async (pn: string) => (pn === '0150' ? { lat: 59.9, lng: 10.7 } : null)),
}));

import { backfillSellerGeocode } from './geo-backfill';

function mockAdmin(sellers: Array<Record<string, unknown>>) {
  const updates: Array<{ table: string; vals: any; col: string; val: unknown }> = [];
  const admin = {
    from(table: string) {
      return {
        select() {
          return {
            not() { return this; },
            is() { return this; },
            limit: async () => ({ data: table === 'seller_profiles' ? sellers : [], error: null }),
          };
        },
        update(vals: unknown) {
          return {
            eq: async (col: string, val: unknown) => { updates.push({ table, vals, col, val }); return { error: null }; },
          };
        },
      };
    },
  };
  return { admin, updates };
}

describe('backfillSellerGeocode', () => {
  it('geocodes sellers missing coords + propagates to listings; skips invalid/no-hit', async () => {
    const { admin, updates } = mockAdmin([
      { id: 's1', postal_code: '0150', city: 'Oslo' },
      { id: 's2', postal_code: '12', city: 'X' },   // not 4 digits → skipped
      { id: 's3', postal_code: '9999', city: 'Y' },  // geocode returns null → skipped
    ]);

    const r = await backfillSellerGeocode(admin as any, { limit: 10 });

    expect(r.scanned).toBe(3);
    expect(r.sellersGeocoded).toBe(1);
    // s1 updated both its seller_profiles row and its listings.
    expect(updates.filter((u) => u.table === 'seller_profiles' && u.val === 's1')).toHaveLength(1);
    expect(updates.filter((u) => u.table === 'listings' && u.val === 's1')).toHaveLength(1);
    // The seller update carries the geocoded point.
    const sellerUpd = updates.find((u) => u.table === 'seller_profiles')!;
    expect(sellerUpd.vals.lat).toBe(59.9);
    expect(sellerUpd.vals.lng).toBe(10.7);
    // Nothing written for the skipped sellers.
    expect(updates.some((u) => u.val === 's2' || u.val === 's3')).toBe(false);
  });
});
