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
  it('creates a store (pending_review) + owner membership from a valid orgnr', async () => {
    const { db, ctx } = ctxWith();
    const res = await createStore(ctx, { orgnr: '971524960', contact_email: 'Kunde@X.no', name: 'Strikkebua' });

    expect(res.ok).toBe(true);
    const store = db.find('stores', { orgnr: '971524960' })!;
    expect(store).toBeTruthy();
    expect(store.status).toBe('pending_review');
    expect(store.legal_name).toBe('Strikk AS');
    expect(store.contact_email).toBe('kunde@x.no'); // normalised
    // Creator is seeded as owner.
    expect(db.find('store_members', { store_id: store.id, user_id: USER })!.role).toBe('owner');
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

  it('rejects a provided slug that is already taken', async () => {
    const { ctx } = ctxWith({
      stores: [{ id: 's0', orgnr: '111111111', slug: 'strikkebua', deleted_at: null, status: 'active' }],
    });
    const res = await createStore(ctx, { orgnr: '971524960', contact_email: 'k@x.no', slug: 'strikkebua' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('conflict');
  });
});
