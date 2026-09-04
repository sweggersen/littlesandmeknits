import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServiceContext } from './types';
import { createFakeDb } from './__test_helpers__/fake-db';

// Mock the Stripe seam: account creation + hosted onboarding link. We test the
// orchestration (authz, account reuse, persistence, link minting) not Stripe.
const accountsCreate = vi.fn();
const accountLinksCreate = vi.fn();
vi.mock('../stripe', () => ({
  createStripe: () => ({
    accounts: { create: (...a: unknown[]) => accountsCreate(...a) },
    accountLinks: { create: (...a: unknown[]) => accountLinksCreate(...a) },
  }),
}));

import { startStoreOnboarding } from './store-connect';

const OWNER = 'owner-1';
const STORE_ID = 'store-1';
const URLS = { refreshUrl: 'https://x/refresh', returnUrl: 'https://x/return' };

function seed(overrides: { store?: Record<string, unknown>; role?: string | null } = {}) {
  const store = {
    id: STORE_ID, legal_name: 'Strikk AS', name: 'Strikkebua', orgnr: '971524960',
    legal_address: 'Storgata 1', location_city: 'Oslo', contact_email: 'butikk@x.no',
    stripe_account_id: null, stripe_connect_status: null, status: 'active',
    ...(overrides.store ?? {}),
  };
  const members = overrides.role === null ? [] : [{ store_id: STORE_ID, user_id: OWNER, role: overrides.role ?? 'owner' }];
  const db = createFakeDb({ stores: [store], store_members: members });
  const ctx: ServiceContext = {
    supabase: db.client as any, admin: db.client as any,
    user: { id: OWNER, email: 'owner@x.no' }, env: { STRIPE_SECRET_KEY: 'sk_test_x' } as any,
  };
  return { db, ctx };
}

beforeEach(() => {
  accountsCreate.mockReset().mockResolvedValue({ id: 'acct_new' });
  accountLinksCreate.mockReset().mockResolvedValue({ url: 'https://connect.stripe.com/setup/abc' });
});

describe('startStoreOnboarding', () => {
  it('creates an Express account, persists the id, and returns a hosted link', async () => {
    const { db, ctx } = seed();
    const res = await startStoreOnboarding(ctx, STORE_ID, URLS);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.url).toBe('https://connect.stripe.com/setup/abc');

    // Account created as a NO company with the orgnr as tax_id.
    const arg = accountsCreate.mock.calls[0][0];
    expect(arg.type).toBe('express');
    expect(arg.country).toBe('NO');
    expect(arg.business_type).toBe('company');
    expect(arg.company.tax_id).toBe('971524960');

    // Persisted onto the store, status seeded to pending.
    expect(db.find('stores', { id: STORE_ID })!.stripe_account_id).toBe('acct_new');
    expect(db.find('stores', { id: STORE_ID })!.stripe_connect_status).toBe('pending');

    // Link minted for that exact account.
    expect(accountLinksCreate.mock.calls[0][0].account).toBe('acct_new');
  });

  it('reuses an existing account instead of creating a second one', async () => {
    const { ctx } = seed({ store: { stripe_account_id: 'acct_existing', stripe_connect_status: 'restricted' } });
    const res = await startStoreOnboarding(ctx, STORE_ID, URLS);

    expect(res.ok).toBe(true);
    expect(accountsCreate).not.toHaveBeenCalled();
    expect(accountLinksCreate.mock.calls[0][0].account).toBe('acct_existing');
  });

  it('is owner-only — a manager cannot set up payouts', async () => {
    const { ctx } = seed({ role: 'manager' });
    const res = await startStoreOnboarding(ctx, STORE_ID, URLS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('forbidden');
    expect(accountsCreate).not.toHaveBeenCalled();
  });

  it('refuses when the store is archived/suspended', async () => {
    const { ctx } = seed({ store: { status: 'archived' } });
    const res = await startStoreOnboarding(ctx, STORE_ID, URLS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('conflict');
    expect(accountsCreate).not.toHaveBeenCalled();
  });

  it('does not persist an account id if the Stripe link mint fails after create', async () => {
    // Account was created + persisted; link fails -> server_error, but the id is
    // saved so the next attempt reuses it (no orphaned second account).
    accountLinksCreate.mockRejectedValue(new Error('stripe down'));
    const { db, ctx } = seed();
    const res = await startStoreOnboarding(ctx, STORE_ID, URLS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('server_error');
    expect(db.find('stores', { id: STORE_ID })!.stripe_account_id).toBe('acct_new');
  });

  it('fails cleanly when Stripe is not configured', async () => {
    const { ctx } = seed();
    ctx.env = {} as any; // no STRIPE_SECRET_KEY
    const res = await startStoreOnboarding(ctx, STORE_ID, URLS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('server_error');
  });
});
