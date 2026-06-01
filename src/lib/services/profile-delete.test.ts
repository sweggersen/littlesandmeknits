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
  failAt?: 'favorites' | 'notifications' | 'notification_preferences' | 'listings_archive' | 'profile_anonymise' | 'auth_delete' | null;
}

function mockCtx(opts: MockOpts = {}) {
  const operations: { table: string; op: string; row?: unknown; status?: string[] }[] = [];
  const authDeleted: string[] = [];

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
          if (table === 'favorites') return { error: getError('favorites') };
          if (table === 'notifications') return { error: getError('notifications') };
          if (table === 'notification_preferences') return { error: getError('notification_preferences') };
          return { error: null };
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
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            authDeleted.push(id);
            return { error: getError('auth_delete') };
          },
        },
      },
    } as any,
    user: { id: 'user-to-delete', email: 'x@y.io' },
    env: {},
  };
  return { ctx, operations, authDeleted };
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

  it('completes the happy path: deletes favorites, notifications, prefs, archives listings, anonymises profile, deletes auth user', async () => {
    const { ctx, operations, authDeleted } = mockCtx({ failAt: null });
    const r = await deleteAccount(ctx, { confirm: 'SLETT' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toMatch(/deleted=1/);

    const tablesTouched = operations.map((o) => `${o.table}:${o.op}`);
    expect(tablesTouched).toContain('favorites:delete');
    expect(tablesTouched).toContain('notifications:delete');
    expect(tablesTouched).toContain('notification_preferences:delete');
    expect(tablesTouched).toContain('listings:update.in');
    expect(tablesTouched).toContain('profiles:update');

    expect(authDeleted).toEqual(['user-to-delete']);
  });

  it('still returns ok even when auth user delete fails (user data already gone)', async () => {
    const { ctx } = mockCtx({ failAt: 'auth_delete' });
    const r = await deleteAccount(ctx, { confirm: 'SLETT' });
    expect(r.ok).toBe(true);
    // The dead-letter record captures the orphan for support; the
    // user-visible part (their data is removed) succeeded.
  });
});
