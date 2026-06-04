import { describe, it, expect, vi } from 'vitest';
import { createListing } from './listings';
import { createMockSupabase, type MockSupabase } from './__test_helpers__/mock-supabase';
import type { ServiceContext } from './types';

// R2-15 — input-validation + persistence coverage for createListing.
// Was 9 validations with zero tests.

vi.mock('../notify', () => ({
  createNotification: vi.fn(),
  notifyModeratorsNewItem: vi.fn(),
  notifyFollowersOfNewListing: vi.fn(),
}));
vi.mock('./dead-letter', () => ({ recordDeadLetter: vi.fn() }));
vi.mock('../stripe', () => ({ createStripe: vi.fn(() => ({})) }));

function ctxFor(mock: MockSupabase, userId = 'seller-1'): ServiceContext {
  return {
    supabase: mock.client as any,
    admin: mock.client as any,
    user: { id: userId, email: 'seller@x.io' },
    env: {} as any,
  };
}

// A complete, valid pre-loved input. Tests clone + mutate this.
const validInput = {
  kind: 'pre_loved',
  title: 'Fin babygenser',
  category: 'genser',
  sizeLabel: '3-6 mnd',
  priceNok: '450',
  condition: 'som_ny',
  description: 'Strikket i merinoull',
  shippingOption: 'small_parcel',
  canShip: 'true',
};

describe('createListing — validation', () => {
  it('rejects an invalid kind', async () => {
    const mock = createMockSupabase({});
    const r = await createListing(ctxFor(mock), { ...validInput, kind: 'auction' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
    expect(mock.inserts('listings')).toHaveLength(0);
  });

  it('rejects an empty title', async () => {
    const mock = createMockSupabase({});
    const r = await createListing(ctxFor(mock), { ...validInput, title: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects an invalid category', async () => {
    const mock = createMockSupabase({});
    const r = await createListing(ctxFor(mock), { ...validInput, category: 'spaceship' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects an empty size label', async () => {
    const mock = createMockSupabase({});
    const r = await createListing(ctxFor(mock), { ...validInput, sizeLabel: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects a non-numeric price', async () => {
    const mock = createMockSupabase({});
    const r = await createListing(ctxFor(mock), { ...validInput, priceNok: 'gratis' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects a negative price', async () => {
    const mock = createMockSupabase({});
    const r = await createListing(ctxFor(mock), { ...validInput, priceNok: '-10' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('requires a condition for pre-loved items', async () => {
    const mock = createMockSupabase({});
    const r = await createListing(ctxFor(mock), { ...validInput, condition: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects an invalid condition value', async () => {
    const mock = createMockSupabase({});
    const r = await createListing(ctxFor(mock), { ...validInput, condition: 'falleferdig' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('allows ready_made without a condition', async () => {
    const mock = createMockSupabase({ insert: { listings: { data: { id: 'new-1' } } } });
    const r = await createListing(ctxFor(mock), {
      kind: 'ready_made', title: 'Ny lue', category: 'lue',
      sizeLabel: 'One size', priceNok: '300', shippingOption: 'small_letter', canShip: 'true',
    });
    expect(r.ok).toBe(true);
    expect(mock.inserts('listings')[0].payload).toMatchObject({ kind: 'ready_made', condition: null });
  });
});

describe('createListing — store membership', () => {
  it('forbids selling under a store you are not a member of', async () => {
    const mock = createMockSupabase({ read: { store_members: null } });
    const r = await createListing(ctxFor(mock), { ...validInput, storeId: 'store-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('rejects selling under an inactive store', async () => {
    const mock = createMockSupabase({
      read: {
        store_members: { role: 'member' },
        stores: { status: 'pending_review', deleted_at: null },
      },
    });
    const r = await createListing(ctxFor(mock), { ...validInput, storeId: 'store-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('forces escrow on for store listings even without the flag', async () => {
    const mock = createMockSupabase({
      read: {
        store_members: { role: 'owner' },
        stores: { status: 'active', deleted_at: null },
      },
      insert: { listings: { data: { id: 'new-2' } } },
    });
    // Even a meet-only store listing (no shipping) keeps escrow on, since the
    // store subscription covers it.
    const r = await createListing(ctxFor(mock), { ...validInput, storeId: 'store-1', canShip: undefined, canMeet: 'true' });
    expect(r.ok).toBe(true);
    expect(mock.inserts('listings')[0].payload).toMatchObject({ store_id: 'store-1', escrow_enabled: true });
  });
});

describe('createListing — persistence', () => {
  it('persists trimmed fields, draft status, and the chosen shipping tier', async () => {
    const mock = createMockSupabase({ insert: { listings: { data: { id: 'new-3' } } } });
    const r = await createListing(ctxFor(mock, 'seller-9'), {
      ...validInput, title: '  Genser  ', description: '  myk  ',
      priceNok: '450', shippingOption: 'small_parcel',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toBe('/market/listing/new-3/foto');

    const ins = mock.inserts('listings')[0].payload as any;
    expect(ins.title).toBe('Genser');
    expect(ins.description).toBe('myk');
    expect(ins.seller_id).toBe('seller-9');
    expect(ins.price_nok).toBe(450);
    expect(ins.status).toBe('draft');
    expect(ins.shipping_option).toBe('small_parcel');
    expect(ins.shipping_price_nok).toBe(76); // locked from the tier table
    expect(ins.condition).toBe('som_ny');
  });

  it('returns server_error and no redirect when the insert fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = createMockSupabase({ insert: { listings: { data: null, error: { message: 'boom' } } } });
    const r = await createListing(ctxFor(mock), validInput);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('server_error');
    consoleSpy.mockRestore();
  });
});
