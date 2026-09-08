import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServiceContext } from './types';
import { createFakeDb } from './__test_helpers__/fake-db';

// Mock the two external seams so this covers createStore's *orchestration*
// (validation, Brønnøysund gating, uniqueness, owner membership) without the
// network. The brreg checksum/parse itself is covered by brreg.test.ts.
const lookupOrgnr = vi.fn();
vi.mock('../brreg', () => ({ lookupOrgnr: (...a: unknown[]) => lookupOrgnr(...a) }));
vi.mock('../notify', () => ({ notifyModeratorsNewItem: vi.fn(async () => {}) }));

import { createStore } from './stores';

const USER = 'user-1';

function orgData(over: Record<string, unknown> = {}) {
  return {
    orgnr: '971524960', legalName: 'Strikk AS', businessType: 'AS',
    businessTypeDescription: 'Aksjeselskap', industryCode: '47.910',
    industryDescription: 'Postordre', address: 'Storgata 1', city: 'Oslo',
    postalCode: '0155', foundedDate: '2020-01-01', status: 'normal', ...over,
  };
}

function ctxWith(seed: Record<string, any[]> = {}) {
  const db = createFakeDb({ stores: [], store_members: [], moderation_queue: [], ...seed });
  const ctx: ServiceContext = {
    supabase: db.client as any, admin: db.client as any,
    user: { id: USER, email: 'eier@x.no' }, env: {} as any,
  };
  return { db, ctx };
}

beforeEach(() => {
  lookupOrgnr.mockReset().mockResolvedValue({ ok: true, data: orgData() });
});

describe('createStore', () => {
  it('creates a VERIFIED business store (pending_review) + owner membership from a valid orgnr', async () => {
    const { db, ctx } = ctxWith();
    const res = await createStore(ctx, { orgnr: '971524960', contact_email: 'Kunde@X.no', name: 'Strikkebua' });

    expect(res.ok).toBe(true);
    const store = db.find('stores', { orgnr: '971524960' })!;
    expect(store).toBeTruthy();
    expect(store.status).toBe('pending_review');
    expect(store.verified).toBe(true);          // valid org number => verified badge
    expect(store.legal_name).toBe('Strikk AS'); // legal_* copied from Brønnøysund
    expect(store.legal_business_type).toBe('AS');
    expect(store.location_city).toBe('Oslo');
    expect(store.contact_email).toBe('kunde@x.no'); // normalised
    // Creator is seeded as owner.
    expect(db.find('store_members', { store_id: store.id, user_id: USER })!.role).toBe('owner');
    // Moderation is enqueued for a business store too.
    expect(db.find('moderation_queue', { item_id: store.id, item_type: 'store' })).toBeTruthy();
  });

  it('creates a PERSONAL store (no orgnr) that is NOT verified and skips Brønnøysund', async () => {
    const { db, ctx } = ctxWith();
    const res = await createStore(ctx, { contact_email: 'meg@x.no', name: 'Kari strikker' });

    expect(res.ok).toBe(true);
    expect(lookupOrgnr).not.toHaveBeenCalled(); // no org lookup for a personal store
    const store = db.rows('stores')[0]!;
    expect(store.name).toBe('Kari strikker');
    expect(store.status).toBe('pending_review'); // still moderated
    expect(store.verified).toBe(false);          // no org number => not verified
    expect(store.orgnr).toBeNull();
    expect(store.legal_name).toBeNull();
    expect(store.location_city).toBeNull();
    // Owner membership + moderation enqueue still happen.
    expect(db.find('store_members', { store_id: store.id, user_id: USER })!.role).toBe('owner');
    expect(db.find('moderation_queue', { item_id: store.id, item_type: 'store' })).toBeTruthy();
  });

  it('lets a personal store fall back to the provided display name (required, >= 2 chars)', async () => {
    const { ctx } = ctxWith();
    const tooShort = await createStore(ctx, { contact_email: 'meg@x.no', name: 'K' });
    expect(tooShort.ok).toBe(false);
    if (!tooShort.ok) expect(tooShort.code).toBe('bad_input');
  });

  it('allows TWO personal stores (both null orgnr) to coexist', async () => {
    const { db, ctx } = ctxWith();
    const a = await createStore(ctx, { contact_email: 'a@x.no', name: 'Butikk A' });
    const b = await createStore(ctx, { contact_email: 'b@x.no', name: 'Butikk B' });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const personal = db.rows('stores').filter((s) => s.orgnr == null);
    expect(personal).toHaveLength(2); // the NULL orgnr UNIQUE tolerance holds
  });

  it('rejects an orgnr that is not "normal" status in Brønnøysund', async () => {
    lookupOrgnr.mockResolvedValue({ ok: true, data: orgData({ status: 'bankrupt' }) });
    const { db, ctx } = ctxWith();
    const res = await createStore(ctx, { orgnr: '971524960', contact_email: 'k@x.no' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('conflict');
    expect(db.find('stores', { orgnr: '971524960' })).toBeUndefined();
  });

  it('rejects a duplicate orgnr (already has a store)', async () => {
    const { ctx } = ctxWith({
      stores: [{ id: 's0', orgnr: '971524960', slug: 'finnes', deleted_at: null, status: 'active' }],
    });
    const res = await createStore(ctx, { orgnr: '971524960', contact_email: 'k@x.no' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('conflict');
  });

  it('surfaces a not_found lookup as not_found', async () => {
    lookupOrgnr.mockResolvedValue({ ok: false, error: 'not_found' });
    const { ctx } = ctxWith();
    const res = await createStore(ctx, { orgnr: '999999999', contact_email: 'k@x.no' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('not_found');
  });

  it('requires a valid contact email before it even hits Brønnøysund', async () => {
    const { ctx } = ctxWith();
    const res = await createStore(ctx, { orgnr: '971524960', contact_email: 'not-an-email' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('bad_input');
    expect(lookupOrgnr).not.toHaveBeenCalled();
  });

  it('is rate-limited: refuses (before the brreg lookup) once the daily quota is hit', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const { db, ctx } = ctxWith({
      user_action_counts: [{ user_id: USER, action: 'store_create', day, count: 5 }], // at the limit
    });
    const res = await createStore(ctx, { orgnr: '971524960', contact_email: 'k@x.no' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('conflict');
    expect(lookupOrgnr).not.toHaveBeenCalled();     // gated before the network call
    expect(db.find('stores', { orgnr: '971524960' })).toBeUndefined();
  });

  it('rejects a provided slug that is already taken', async () => {
    const { ctx } = ctxWith({
      stores: [{ id: 's0', orgnr: '111111111', slug: 'strikkebua', deleted_at: null, status: 'active' }],
    });
    const res = await createStore(ctx, { orgnr: '971524960', contact_email: 'k@x.no', slug: 'strikkebua' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('conflict');
  });
});
