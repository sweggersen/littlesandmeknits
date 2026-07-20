import { describe, it, expect } from 'vitest';
import { convertMyListingsToStore } from './store-conversion';
import { createFakeDb } from './__test_helpers__/fake-db';
import type { ServiceContext } from './types';

const OWNER = 'owner-1';
const STORE = 'store-1';

function ctxWith(db: ReturnType<typeof createFakeDb>): ServiceContext {
  return {
    supabase: db.client as any,
    admin: db.client as any,
    user: { id: OWNER, email: 'owner@x.io' },
    env: {} as any,
  };
}

function seed() {
  return createFakeDb({
    store_members: [{ store_id: STORE, user_id: OWNER, role: 'owner' }],
    listings: [
      { id: 'l1', seller_id: OWNER, store_id: null },
      { id: 'l2', seller_id: OWNER, store_id: null },
      { id: 'l3', seller_id: OWNER, store_id: null },
      { id: 'other', seller_id: 'someone-else', store_id: null }, // must never move
    ],
    seller_reviews: [],
  });
}

describe('convertMyListingsToStore', () => {
  it('moves only the selected listings when ids are given', async () => {
    const db = seed();
    const r = await convertMyListingsToStore(ctxWith(db), STORE, ['l1', 'l3']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.listingsMoved).toBe(2);
    expect(db.find('listings', { id: 'l1' })!.store_id).toBe(STORE);
    expect(db.find('listings', { id: 'l3' })!.store_id).toBe(STORE);
    expect(db.find('listings', { id: 'l2' })!.store_id).toBeNull(); // untouched
  });

  it('moves all personal listings when no ids are given', async () => {
    const db = seed();
    const r = await convertMyListingsToStore(ctxWith(db), STORE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.listingsMoved).toBe(3);
    for (const id of ['l1', 'l2', 'l3']) expect(db.find('listings', { id })!.store_id).toBe(STORE);
  });

  it('never moves another seller\'s listing, even if its id is passed', async () => {
    const db = seed();
    const r = await convertMyListingsToStore(ctxWith(db), STORE, ['l1', 'other']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.listingsMoved).toBe(1); // only l1
    expect(db.find('listings', { id: 'other' })!.store_id).toBeNull();
  });

  it('refuses when the caller is not the store owner', async () => {
    const db = createFakeDb({
      store_members: [{ store_id: STORE, user_id: OWNER, role: 'member' }],
      listings: [{ id: 'l1', seller_id: OWNER, store_id: null }],
    });
    const r = await convertMyListingsToStore(ctxWith(db), STORE, ['l1']);
    expect(r.ok).toBe(false);
    expect(db.find('listings', { id: 'l1' })!.store_id).toBeNull();
  });
});
