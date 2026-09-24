import { describe, it, expect } from 'vitest';
import { subscribePush, unsubscribePush } from './push';
import type { ServiceContext } from './types';

function mockCtx(upsertError?: { message: string }) {
  const operations: Array<{ op: string; data: unknown }> = [];
  const client = {
    from: (_table: string) => ({
      upsert: async (row: unknown) => {
        operations.push({ op: 'upsert', data: row });
        return { error: upsertError ?? null };
      },
      delete: () => ({
        eq: (col1: string, _v1: unknown) => ({
          eq: async (col2: string, v2: unknown) => {
            operations.push({ op: 'delete', data: { [col1]: 'eq', [col2]: v2 } });
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
  return { ctx, operations };
}

describe('subscribePush', () => {
  it('rejects missing endpoint', async () => {
    const { ctx } = mockCtx();
    const result = await subscribePush(ctx, { endpoint: '', p256dh: 'a', auth: 'b' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects missing p256dh', async () => {
    const { ctx } = mockCtx();
    const result = await subscribePush(ctx, { endpoint: 'https://...', p256dh: '', auth: 'b' });
    expect(result.ok).toBe(false);
  });

  it('rejects missing auth', async () => {
    const { ctx } = mockCtx();
    const result = await subscribePush(ctx, { endpoint: 'https://...', p256dh: 'a', auth: '' });
    expect(result.ok).toBe(false);
  });

  it('upserts with all fields when valid', async () => {
    const { ctx, operations } = mockCtx();
    const result = await subscribePush(ctx, {
      endpoint: 'https://fcm.googleapis.com/x',
      p256dh: 'key-data', auth: 'auth-data',
    });
    expect(result.ok).toBe(true);
    expect(operations).toHaveLength(1);
    expect(operations[0].op).toBe('upsert');
    expect(operations[0].data).toMatchObject({
      user_id: 'u1',
      endpoint: 'https://fcm.googleapis.com/x',
      p256dh: 'key-data',
      auth: 'auth-data',
    });
  });

  it('returns server_error when upsert fails', async () => {
    const { ctx } = mockCtx({ message: 'unique violation' });
    const result = await subscribePush(ctx, {
      endpoint: 'https://fcm.googleapis.com/x', p256dh: 'a', auth: 'b',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('server_error');
  });

  it('rejects an endpoint whose host is NOT a real push service (SSRF guard)', async () => {
    const { ctx, operations } = mockCtx();
    for (const bad of [
      'https://attacker.example.com/x',
      'https://169.254.169.254/latest/meta-data',
      'https://fcm.googleapis.com.evil.com/x', // suffix-spoof
      'http://fcm.googleapis.com/x',           // not https
    ]) {
      const r = await subscribePush(ctx, { endpoint: bad, p256dh: 'a', auth: 'b' });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.code).toBe('bad_input');
    }
    expect(operations).toHaveLength(0); // nothing was ever stored
  });

  it('accepts each real push-service host', async () => {
    for (const good of [
      'https://fcm.googleapis.com/x',
      'https://updates.push.services.mozilla.com/x',
      'https://web.push.apple.com/x',
      'https://par02p.notify.windows.com/x',
    ]) {
      const { ctx } = mockCtx();
      const r = await subscribePush(ctx, { endpoint: good, p256dh: 'a', auth: 'b' });
      expect(r.ok, good).toBe(true);
    }
  });
});

describe('unsubscribePush', () => {
  it('rejects missing endpoint', async () => {
    const { ctx } = mockCtx();
    const result = await unsubscribePush(ctx, { endpoint: '' });
    expect(result.ok).toBe(false);
  });

  it('deletes the subscription for the user+endpoint', async () => {
    const { ctx, operations } = mockCtx();
    const result = await unsubscribePush(ctx, { endpoint: 'https://x' });
    expect(result.ok).toBe(true);
    expect(operations).toHaveLength(1);
    expect(operations[0].op).toBe('delete');
  });
});
