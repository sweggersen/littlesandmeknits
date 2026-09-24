import { describe, it, expect, vi } from 'vitest';
import { deleteAccount } from './profile';
import type { ServiceContext } from './types';

vi.mock('./dead-letter', () => ({ recordDeadLetter: vi.fn() }));

interface MockOpts {
  /** Counts for the three pre-flight blocker checks. */
  openListings?: number;
  pendingPurchases?: number;
  openThreads?: number;
  /** Which step should fail. */
  failAt?: 'favorites' | 'notifications' | 'notification_preferences' | 'listings_archive'
    | 'seller_profiles' | 'auth_identities' | 'buyer_preferences' | 'profile_anonymise' | 'ban' | null;
}

function mockCtx(opts: MockOpts = {}) {
  const operations: { table: string; op: string; row?: unknown; status?: string[] }[] = [];
  const banned: string[] = [];

  // Counts for the pre-flight blocker checks, in call order:
  //   1. open listings (seller_id, status IN reserved/shipped/disputed/frozen)
  //   2. pending purchases (buyer_id, status IN reserved/shipped/disputed)
  //   3. open threads (recipient_id, status = open)
  const countSequence: number[] = [
    opts.openListings ?? 0,
    opts.pendingPurchases ?? 0,
    opts.openThreads ?? 0,
  ];

  function getError(step: string) {
    return opts.failAt === step ? { message: `simulated ${step} failure` } : null;
  }

  function builder(table: string) {
    return {
      select: (_: string, sel?: any) => {
        if (sel?.head) {
          return {
            eq: () => ({
              in: async () => ({ count: countSequence.shift() ?? 0 }),
              eq: async () => ({ count: countSequence.shift() ?? 0 }),
            }),
          };
        }
        return { eq: () => ({ maybeSingle: async () => ({ data: null }) }) };
      },
      delete: () => ({
        eq: async () => {
          operations.push({ table, op: 'delete' });
          // Step name == table name for the delete steps, so getError maps directly.
          return { error: getError(table) };
        },
      }),
      update: (row: unknown) => {
        const tail: any = {
          eq: (_col: string, _val: unknown) => {
            // Direct await: update().eq()
            const result = {
              error: table === 'profiles' ? getError('profile_anonymise') : null,
            };
            operations.push({ table, op: 'update', row });
            const eqChain: any = {
              in: async () => {
                operations.push({ table, op: 'update.in', row });
                return { error: getError('listings_archive') };
              },
              eq: () => eqChain,
              then(cb: any) { return cb(result); },
            };
            return eqChain;
          },
        };
        return tail;
      },
    };
  }

  const client = { from: (t: string) => builder(t) };
  const ctx: ServiceContext = {
    supabase: client as any,
    admin: {
      ...client,
      storage: {
        from: () => ({
          list: async () => ({ data: [] }),
          remove: async () => ({ error: null }),
        }),
      },
      auth: {
        admin: {
          // The tombstone bans the auth user (can't hard-delete: orders FK is
          // ON DELETE RESTRICT) instead of deleting it.
          updateUserById: async (id: string, _attrs: unknown) => {
            banned.push(id);
            return { error: getError('ban') };
          },
        },
      },
    } as any,
    user: { id: 'user-to-delete', email: 'x@y.io' },
    env: {},
  };
  return { ctx, operations, banned };
}

describe('deleteAccount — confirmation', () => {
  it('rejects when confirm text is wrong', async () => {
    const r = await deleteAccount(mockCtx().ctx, { confirm: 'delete' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects when confirm text is empty', async () => {
    const r = await deleteAccount(mockCtx().ctx, { confirm: '' });
    expect(r.ok).toBe(false);
  });
});

describe('deleteAccount — pre-flight blockers', () => {
  it('refuses when user has active sales', async () => {
    const r = await deleteAccount(mockCtx({ openListings: 1 }).ctx, { confirm: 'SLETT' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('conflict');
      expect(r.message).toMatch(/aktive salg/);
    }
  });

  it('refuses when user has pending purchases', async () => {
    const r = await deleteAccount(mockCtx({ pendingPurchases: 2 }).ctx, { confirm: 'SLETT' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/aktive kjøp/);
  });

  it('refuses when user has open moderation threads', async () => {
    const r = await deleteAccount(mockCtx({ openThreads: 1 }).ctx, { confirm: 'SLETT' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/moderasjonssaker/);
  });
});

describe('deleteAccount — fail-fast', () => {
  it('halts at favorites delete failure WITHOUT anonymising profile', async () => {
    const { ctx, operations } = mockCtx({ failAt: 'favorites' });
    const r = await deleteAccount(ctx, { confirm: 'SLETT' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('server_error');

    // Profile should NOT have been updated (it's the LAST step).
    const profileUpdated = operations.find((o) => o.table === 'profiles' && o.op === 'update');
    expect(profileUpdated, 'profile must not be anonymised when favorites delete fails').toBeUndefined();
  });

  it('halts at notifications delete failure WITHOUT touching profile or listings', async () => {
    const { ctx, operations } = mockCtx({ failAt: 'notifications' });
    const r = await deleteAccount(ctx, { confirm: 'SLETT' });
    expect(r.ok).toBe(false);

    const listingsTouched = operations.find((o) => o.table === 'listings');
    expect(listingsTouched).toBeUndefined();
    const profileUpdated = operations.find((o) => o.table === 'profiles' && o.op === 'update');
    expect(profileUpdated).toBeUndefined();
  });

  it('halts at listings archive failure WITHOUT anonymising profile', async () => {
    const { ctx, operations } = mockCtx({ failAt: 'listings_archive' });
    const r = await deleteAccount(ctx, { confirm: 'SLETT' });
    expect(r.ok).toBe(false);

    const profileUpdated = operations.find((o) => o.table === 'profiles' && o.op === 'update');
    expect(profileUpdated).toBeUndefined();
  });

  it('completes the happy path: deletes favorites/notifications/prefs + the PII tables, anonymises orders + profile, bans the auth user', async () => {
    const { ctx, operations, banned } = mockCtx({ failAt: null });
    const r = await deleteAccount(ctx, { confirm: 'SLETT' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toMatch(/deleted=1/);

    const tablesTouched = operations.map((o) => `${o.table}:${o.op}`);
    expect(tablesTouched).toContain('favorites:delete');
    expect(tablesTouched).toContain('notifications:delete');
    expect(tablesTouched).toContain('notification_preferences:delete');
    expect(tablesTouched).toContain('listings:update.in');
    // The split PII tables are now explicitly deleted (were relying on a cascade
    // that never fired for transacting users).
    expect(tablesTouched).toContain('seller_profiles:delete');
    expect(tablesTouched).toContain('auth_identities:delete');
    expect(tablesTouched).toContain('buyer_preferences:delete');
    // Orders keep their financial record but get their shipping PII stripped.
    expect(tablesTouched).toContain('orders:update');
    expect(tablesTouched).toContain('profiles:update');

    // Login is disabled by BANNING the auth user (not deleting it).
    expect(banned).toEqual(['user-to-delete']);
  });

  it('halts at a PII-table delete failure WITHOUT anonymising the profile', async () => {
    const { ctx, operations } = mockCtx({ failAt: 'seller_profiles' });
    const r = await deleteAccount(ctx, { confirm: 'SLETT' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('server_error');
    const profileUpdated = operations.find((o) => o.table === 'profiles' && o.op === 'update');
    expect(profileUpdated, 'profile must not be anonymised when a PII delete fails').toBeUndefined();
  });

  it('still returns ok when the ban fails (PII already erased; support mops up)', async () => {
    const { ctx } = mockCtx({ failAt: 'ban' });
    const r = await deleteAccount(ctx, { confirm: 'SLETT' });
    expect(r.ok).toBe(true);
    // The dead-letter captures the un-banned account for support; the erasure
    // (the legal obligation) succeeded.
  });
});
