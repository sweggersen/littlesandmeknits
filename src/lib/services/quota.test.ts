import { describe, it, expect } from 'vitest';
import { assertWithinQuota, getQuotaUsed } from './quota';
import type { ServiceContext } from './types';

function mockCtx(initialCount = 0) {
  let stored = initialCount;
  const upserts: unknown[] = [];
  const client = {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: stored > 0 ? { count: stored } : null }),
            }),
          }),
        }),
      }),
      upsert: async (row: unknown) => {
        upserts.push(row);
        stored = (row as { count: number }).count;
        return { error: null };
      },
    }),
  };
  const ctx: ServiceContext = {
    supabase: client as any,
    admin: client as any,
    user: { id: 'u1', email: 'x@y.io' },
    env: {},
  };
  return { ctx, upserts, peek: () => stored };
}

describe('assertWithinQuota', () => {
  it('allows the first action of the day', async () => {
    const { ctx, upserts } = mockCtx(0);
    const r = await assertWithinQuota(ctx, 'commission_request_create');
    expect(r).toBeNull();
    expect(upserts).toHaveLength(1);
    expect((upserts[0] as any).count).toBe(1);
  });

  it('allows the 5th commission request (the limit)', async () => {
    const { ctx, upserts } = mockCtx(4);
    const r = await assertWithinQuota(ctx, 'commission_request_create');
    expect(r).toBeNull();
    expect((upserts[0] as any).count).toBe(5);
  });

  it('blocks the 6th commission request', async () => {
    const { ctx, upserts } = mockCtx(5);
    const r = await assertWithinQuota(ctx, 'commission_request_create');
    expect(r).not.toBeNull();
    if (r && !r.ok) expect(r.code).toBe('conflict');
    expect(upserts).toHaveLength(0); // doesn't increment past limit
  });

  it('uses the right limit per action — offers cap at 20', async () => {
    const { ctx } = mockCtx(20);
    const r = await assertWithinQuota(ctx, 'commission_offer_make');
    expect(r).not.toBeNull();
    if (r && !r.ok) expect(r.code).toBe('conflict');
  });

  it('uses the right limit per action — messages cap at 100', async () => {
    const { ctx: blocked } = mockCtx(100);
    expect(await assertWithinQuota(blocked, 'marketplace_message_send')).not.toBeNull();
    const { ctx: allowed } = mockCtx(99);
    expect(await assertWithinQuota(allowed, 'marketplace_message_send')).toBeNull();
  });

  it('upsert row contains user_id + action + day + count', async () => {
    const { ctx, upserts } = mockCtx(0);
    await assertWithinQuota(ctx, 'commission_offer_make');
    expect(upserts[0]).toMatchObject({
      user_id: 'u1',
      action: 'commission_offer_make',
      count: 1,
    });
    expect((upserts[0] as any).day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getQuotaUsed', () => {
  it('reports current count + limit', async () => {
    const { ctx } = mockCtx(3);
    const r = await getQuotaUsed(ctx, 'commission_request_create');
    expect(r).toEqual({ used: 3, limit: 5 });
  });

  it('reports zero when no row exists', async () => {
    const { ctx } = mockCtx(0);
    const r = await getQuotaUsed(ctx, 'commission_request_create');
    expect(r).toEqual({ used: 0, limit: 5 });
  });
});
