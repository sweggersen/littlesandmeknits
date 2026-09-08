import { describe, it, expect } from 'vitest';
import { createFakeDb, type FakeDb } from './__test_helpers__/fake-db';
import type { ServiceContext } from './types';
import { setMemberVisibility } from './store-members';

const STORE = 'store-1';
const OWNER = 'owner-1';
const MANAGER = 'manager-1';
const TARGET = 'target-1';

function seed(): FakeDb {
  return createFakeDb({
    store_members: [
      { store_id: STORE, user_id: OWNER, role: 'owner', visible_on_storefront: true },
      { store_id: STORE, user_id: MANAGER, role: 'manager', visible_on_storefront: true },
      { store_id: STORE, user_id: TARGET, role: 'contributor', visible_on_storefront: false },
    ],
  });
}

function ctxFor(db: FakeDb, userId: string): ServiceContext {
  return {
    supabase: db.client as any,
    admin: db.client as any,
    user: { id: userId, email: `${userId}@x.io` },
    env: {} as any,
  };
}

describe('setMemberVisibility', () => {
  it('an owner can reveal another member in the team panel', async () => {
    const db = seed();
    const r = await setMemberVisibility(ctxFor(db, OWNER), STORE, TARGET, true);
    expect(r.ok).toBe(true);
    expect(db.find('store_members', { store_id: STORE, user_id: TARGET })?.visible_on_storefront).toBe(true);
  });

  it('an owner can hide a member', async () => {
    const db = seed();
    await setMemberVisibility(ctxFor(db, OWNER), STORE, MANAGER, false);
    expect(db.find('store_members', { store_id: STORE, user_id: MANAGER })?.visible_on_storefront).toBe(false);
  });

  it('a manager (below admin) cannot toggle others', async () => {
    const db = seed();
    const r = await setMemberVisibility(ctxFor(db, MANAGER), STORE, TARGET, true);
    expect(r.ok).toBe(false);
    // Unchanged.
    expect(db.find('store_members', { store_id: STORE, user_id: TARGET })?.visible_on_storefront).toBe(false);
  });

  it('a non-member gets forbidden', async () => {
    const db = seed();
    const r = await setMemberVisibility(ctxFor(db, 'stranger'), STORE, TARGET, true);
    expect(r.ok).toBe(false);
  });

  it('returns not_found for an unknown target', async () => {
    const db = seed();
    const r = await setMemberVisibility(ctxFor(db, OWNER), STORE, 'ghost', true);
    expect(r.ok).toBe(false);
  });
});
