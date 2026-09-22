import { describe, it, expect, vi } from 'vitest';

vi.mock('../geocode', () => ({
  geocodePostnummer: vi.fn(async (pn: string) => (pn === '0150' ? { lat: 59.9, lng: 10.7 } : null)),
  // Resolves only a query for the "known" street; everything else falls back.
  geocodeAddress: vi.fn(async (q: string) => (q.includes('Storgata') ? { lat: 60.1, lng: 11.2 } : null)),
  composeStoreAddressQuery: (address: string, pn: string, city: string | null) =>
    [address, [pn, city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
}));

import { backfillSellerGeocode, backfillStoreGeocode } from './geo-backfill';

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

function mockStoreAdmin(stores: Array<Record<string, unknown>>) {
  const updates: Array<{ table: string; vals: any; col: string; val: unknown }> = [];
  const admin = {
    from(table: string) {
      return {
        select() {
          return {
            eq() { return this; },
            is() { return this; },
            limit: async () => ({ data: table === 'stores' ? stores : [], error: null }),
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

describe('backfillStoreGeocode', () => {
  it('upgrades to EXACT from the address, falls back to COARSE, skips bad postnummer', async () => {
    const { admin, updates } = mockStoreAdmin([
      // exact: address resolves
      { id: 'a', postnummer: '0150', location_city: 'Oslo', legal_address: null, store_private_details: { precise_address: 'Storgata 1' } },
      // coarse: no address, postnummer centroid used
      { id: 'b', postnummer: '0150', location_city: 'Oslo', legal_address: null, store_private_details: null },
      // skipped: invalid postnummer
      { id: 'c', postnummer: '12', location_city: 'X', legal_address: 'Storgata 9', store_private_details: null },
      // skipped: address doesn't resolve AND postnummer has no hit
      { id: 'd', postnummer: '9999', location_city: 'Y', legal_address: 'Ukjent vei 2', store_private_details: null },
    ]);

    const r = await backfillStoreGeocode(admin as any, { limit: 10 });

    expect(r.scanned).toBe(4);
    expect(r.storesGeocoded).toBe(2);

    const a = updates.find((u) => u.val === 'a')!;
    expect(a.vals.geocode_precision).toBe('exact');
    expect(a.vals.lat).toBe(60.1); // the address point, not the centroid

    const b = updates.find((u) => u.val === 'b')!;
    expect(b.vals.geocode_precision).toBe('coarse');
    expect(b.vals.lat).toBe(59.9); // postnummer centroid

    // Nothing written for the skipped stores.
    expect(updates.some((u) => u.val === 'c' || u.val === 'd')).toBe(false);
  });

  it('reads precise_address when the embed comes back as an array', async () => {
    const { admin, updates } = mockStoreAdmin([
      { id: 'x', postnummer: '0150', location_city: 'Oslo', legal_address: null, store_private_details: [{ precise_address: 'Storgata 3' }] },
    ]);
    const r = await backfillStoreGeocode(admin as any, { limit: 10 });
    expect(r.storesGeocoded).toBe(1);
    expect(updates.find((u) => u.val === 'x')!.vals.geocode_precision).toBe('exact');
  });
});
