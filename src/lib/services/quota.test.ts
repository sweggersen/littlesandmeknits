import { describe, it, expect } from 'vitest';
import { assertWithinQuota, getQuotaUsed } from './quota';
import type { ServiceContext } from './types';

// assertWithinQuota now does the increment atomically in Postgres via the
// bump_action_count RPC (migration 0119), which returns the new count or -1 when
// at/over the limit. getQuotaUsed still does a plain read.
function mockCtx(opts: { rpcCount?: number; rpcError?: { message: string }; storedCount?: number } = {}) {
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const stored = opts.storedCount ?? 0;
  const client = {
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      return { data: opts.rpcCount ?? 1, error: null };
    },
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored > 0 ? { count: stored } : null }) }) }) }),
      }),
    }),
  };
  const ctx: ServiceContext = {
    supabase: client as any,
    admin: client as any,
    user: { id: 'u1', email: 'x@y.io' },
    env: {},
  };
  return { ctx, rpcCalls };
}

describe('assertWithinQuota', () => {
  it('allows when the RPC returns a count under the limit', async () => {
    const { ctx } = mockCtx({ rpcCount: 1 });
    expect(await assertWithinQuota(ctx, 'commission_request_create')).toBeNull();
  });

  it('allows when the RPC returns exactly the limit', async () => {
    const { ctx } = mockCtx({ rpcCount: 5 });
    expect(await assertWithinQuota(ctx, 'commission_request_create')).toBeNull();
  });

  it('blocks when the RPC returns -1 (at/over limit)', async () => {
    const { ctx } = mockCtx({ rpcCount: -1 });
    const r = await assertWithinQuota(ctx, 'commission_request_create');
    expect(r).not.toBeNull();
    if (r && !r.ok) expect(r.code).toBe('conflict');
  });

  it('calls the RPC with user_id, action, day and the action limit', async () => {
    const { ctx, rpcCalls } = mockCtx({ rpcCount: 1 });
    await assertWithinQuota(ctx, 'commission_offer_make');
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('bump_action_count');
    expect(rpcCalls[0].args).toMatchObject({
      p_user_id: 'u1',
      p_action: 'commission_offer_make',
      p_limit: 20, // the offers cap
    });
    expect(rpcCalls[0].args.p_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('passes the right per-action limit (messages cap at 100)', async () => {
    const { ctx, rpcCalls } = mockCtx({ rpcCount: 1 });
    await assertWithinQuota(ctx, 'marketplace_message_send');
    expect(rpcCalls[0].args.p_limit).toBe(100);
  });

  it('fails open (allows) when the RPC errors, rather than blocking users', async () => {
    const { ctx } = mockCtx({ rpcError: { message: 'boom' } });
    expect(await assertWithinQuota(ctx, 'commission_request_create')).toBeNull();
  });
});

describe('getQuotaUsed', () => {
  it('reports current count + limit', async () => {
    const { ctx } = mockCtx({ storedCount: 3 });
    expect(await getQuotaUsed(ctx, 'commission_request_create')).toEqual({ used: 3, limit: 5 });
  });

  it('reports zero when no row exists', async () => {
    const { ctx } = mockCtx({ storedCount: 0 });
    expect(await getQuotaUsed(ctx, 'commission_request_create')).toEqual({ used: 0, limit: 5 });
  });
});
