import { describe, it, expect, vi } from 'vitest';
import { toggleSellerFollow } from './seller-follows';
import type { ServiceContext } from './types';

function mockCtx(insertResult: { error: { code?: string; message?: string } | null }) {
  const ops: Array<{ op: string; row?: unknown }> = [];
  const client = {
    from: () => ({
      insert: async (row: unknown) => { ops.push({ op: 'insert', row }); return insertResult; },
      delete: () => ({ eq: () => ({ eq: async () => { ops.push({ op: 'delete' }); return { error: null }; } }) }),
    }),
  };
  const ctx: ServiceContext = {
    supabase: client as any, admin: client as any,
    user: { id: 'u1', email: 'x@y.io' }, env: {},
  };
  return { ctx, ops };
}

describe('toggleSellerFollow', () => {
  it('rejects a missing seller id', async () => {
    const { ctx } = mockCtx({ error: null });
    const r = await toggleSellerFollow(ctx, '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects following yourself', async () => {
    const { ctx } = mockCtx({ error: null });
    const r = await toggleSellerFollow(ctx, 'u1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('inserts and returns following=true on first toggle', async () => {
    const { ctx, ops } = mockCtx({ error: null });
    const r = await toggleSellerFollow(ctx, 's1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.following).toBe(true);
    expect(ops[0]).toEqual({ op: 'insert', row: { follower_id: 'u1', seller_id: 's1' } });
  });

  it('treats a unique-violation as already-following and unfollows', async () => {
    const { ctx, ops } = mockCtx({ error: { code: '23505' } });
    const r = await toggleSellerFollow(ctx, 's1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.following).toBe(false);
    expect(ops.find((o) => o.op === 'delete')).toBeTruthy();
  });

  it('maps a FK violation to not_found', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx } = mockCtx({ error: { code: '23503' } });
    const r = await toggleSellerFollow(ctx, 'ghost');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
    spy.mockRestore();
  });
});
