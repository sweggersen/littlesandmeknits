import { describe, it, expect, vi } from 'vitest';
import { toggleFavorite } from './favorites';
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
          eq: () => ({
            eq: async () => {
              ops.push({ op: 'delete' });
              return { error: null };
            },
          }),
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

describe('toggleFavorite', () => {
  it('rejects invalid item_type', async () => {
    const { ctx } = mockCtx({ error: null });
    const r = await toggleFavorite(ctx, { itemType: 'project', itemId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects missing item_id', async () => {
    const { ctx } = mockCtx({ error: null });
    const r = await toggleFavorite(ctx, { itemType: 'listing', itemId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('inserts and returns favorited=true on first toggle', async () => {
    const { ctx, ops } = mockCtx({ error: null });
    const r = await toggleFavorite(ctx, { itemType: 'listing', itemId: 'l1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.favorited).toBe(true);
    expect(ops[0]).toEqual({ op: 'insert', row: { user_id: 'u1', item_type: 'listing', item_id: 'l1' } });
  });

  it('treats unique-violation as already-favourited and deletes the row', async () => {
    const { ctx, ops } = mockCtx({ error: { code: '23505' } });
    const r = await toggleFavorite(ctx, { itemType: 'listing', itemId: 'l1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.favorited).toBe(false);
    expect(ops.find((o) => o.op === 'delete')).toBeTruthy();
  });

  it('surfaces other DB errors as server_error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx } = mockCtx({ error: { code: '42P01', message: 'table missing' } });
    const r = await toggleFavorite(ctx, { itemType: 'commission_request', itemId: 'c1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('server_error');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('accepts commission_request as a valid type', async () => {
    const { ctx, ops } = mockCtx({ error: null });
    const r = await toggleFavorite(ctx, { itemType: 'commission_request', itemId: 'c1' });
    expect(r.ok).toBe(true);
    expect(ops[0]).toMatchObject({ op: 'insert', row: { item_type: 'commission_request' } });
  });
});
