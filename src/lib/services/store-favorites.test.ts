import { describe, it, expect, vi } from 'vitest';
import { toggleStoreFavorite, markStoreSeen } from './store-favorites';
import type { ServiceContext } from './types';

function mockCtx(insertResult: { error: { code?: string; message?: string } | null }) {
  const ops: Array<{ op: string; row?: unknown }> = [];
  const client = {
    from: () => ({
      insert: async (row: unknown) => {
        ops.push({ op: 'insert', row });
        return insertResult;
      },
      delete: () => ({
        eq: () => ({
          eq: async () => {
            ops.push({ op: 'delete' });
            return { error: null };
          },
        }),
      }),
      update: (row: unknown) => ({
        eq: () => ({
          eq: async () => {
            ops.push({ op: 'update', row });
            return { error: null };
          },
        }),
      }),
    }),
  };
  const ctx: ServiceContext = {
    supabase: client as any,
    admin: client as any,
    user: { id: 'u1', email: 'x@y.io' },
    env: {},
  };
  return { ctx, ops };
}

describe('toggleStoreFavorite', () => {
  it('rejects a missing store id', async () => {
    const { ctx } = mockCtx({ error: null });
    const r = await toggleStoreFavorite(ctx, '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('inserts and returns favorited=true on first toggle', async () => {
    const { ctx, ops } = mockCtx({ error: null });
    const r = await toggleStoreFavorite(ctx, 's1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.favorited).toBe(true);
    expect(ops[0]).toEqual({ op: 'insert', row: { user_id: 'u1', store_id: 's1' } });
  });

  it('treats a unique-violation as already-favourited and deletes', async () => {
    const { ctx, ops } = mockCtx({ error: { code: '23505' } });
    const r = await toggleStoreFavorite(ctx, 's1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.favorited).toBe(false);
    expect(ops.find((o) => o.op === 'delete')).toBeTruthy();
  });

  it('maps a FK violation to not_found', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx } = mockCtx({ error: { code: '23503' } });
    const r = await toggleStoreFavorite(ctx, 'ghost');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
    consoleSpy.mockRestore();
  });

  it('surfaces other DB errors as server_error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx } = mockCtx({ error: { code: '42P01', message: 'table missing' } });
    const r = await toggleStoreFavorite(ctx, 's1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('server_error');
    consoleSpy.mockRestore();
  });
});

describe('markStoreSeen', () => {
  it('bumps last_seen_at on the caller-and-store scoped row', async () => {
    const { ctx, ops } = mockCtx({ error: null });
    const r = await markStoreSeen(ctx, 's1');
    expect(r.ok).toBe(true);
    const upd = ops.find((o) => o.op === 'update');
    expect(upd).toBeTruthy();
    expect((upd!.row as { last_seen_at?: string }).last_seen_at).toBeTruthy();
  });

  it('rejects a missing store id', async () => {
    const { ctx } = mockCtx({ error: null });
    const r = await markStoreSeen(ctx, '');
    expect(r.ok).toBe(false);
  });
});
