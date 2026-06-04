import { describe, it, expect } from 'vitest';
import { createFakeDb } from './__test_helpers__/fake-db';
import { createListing } from './listings';
import type { ServiceContext } from './types';

function ctxFor(db: ReturnType<typeof createFakeDb>): ServiceContext {
  return { admin: db.client, supabase: db.client, user: { id: 'u1', email: 'u1@test.no' }, env: {} } as unknown as ServiceContext;
}

const base = {
  kind: 'ready_made', title: 'Babylue', category: 'lue', sizeLabel: '0-3 mnd', priceNok: '250',
};

describe('createListing — delivery modes', () => {
  it('kan sendes → escrow on, shipping tier stored', async () => {
    const db = createFakeDb({ listings: [] });
    const r = await createListing(ctxFor(db), { ...base, canShip: 'true', shippingOption: 'small_parcel' });
    expect(r.ok).toBe(true);
    const row = db.rows('listings')[0];
    expect(row.escrow_enabled).toBe(true);
    expect(row.can_meet).toBe(false);
    expect(row.shipping_option).toBe('small_parcel');
  });

  it('kan møtes only → escrow off, no shipping option', async () => {
    const db = createFakeDb({ listings: [] });
    const r = await createListing(ctxFor(db), { ...base, canMeet: 'true' });
    expect(r.ok).toBe(true);
    const row = db.rows('listings')[0];
    expect(row.escrow_enabled).toBe(false);
    expect(row.can_meet).toBe(true);
    expect(row.shipping_option).toBeNull();
    expect(row.shipping_price_nok).toBe(0);
  });

  it('both → escrow on (shipping wins) + can_meet true', async () => {
    const db = createFakeDb({ listings: [] });
    const r = await createListing(ctxFor(db), { ...base, canShip: 'true', canMeet: 'true', shippingOption: 'free' });
    expect(r.ok).toBe(true);
    const row = db.rows('listings')[0];
    expect(row.escrow_enabled).toBe(true);
    expect(row.can_meet).toBe(true);
    expect(row.shipping_option).toBe('free');
  });

  it('neither → rejected', async () => {
    const db = createFakeDb({ listings: [] });
    const r = await createListing(ctxFor(db), { ...base });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
    expect(db.rows('listings').length).toBe(0);
  });
});
