import { describe, it, expect, vi } from 'vitest';
import { deleteNotification, updatePreferences, markRead, markAllRead } from './notifications';
import type { ServiceContext } from './types';

function mockCtx(opts?: { upsertError?: { message: string } | null }) {
  const ops: Array<{ op: string; data?: unknown; eqs?: Record<string, unknown> }> = [];
  const client = {
    from: () => ({
      delete: () => ({
        eq: (col: string, val: unknown) => {
          const eqs: Record<string, unknown> = { [col]: val };
          const node = {
            eq: (c2: string, v2: unknown) => { eqs[c2] = v2; return node; },
            then: (res: (r: { error: null }) => unknown) => {
              ops.push({ op: 'delete', eqs });
              return Promise.resolve({ error: null }).then(res);
            },
          };
          return node;
        },
      }),
      upsert: async (row: unknown) => {
        ops.push({ op: 'upsert', data: row });
        return { error: opts?.upsertError ?? null };
      },
      update: (row: unknown) => ({
        eq: (col1: string, val1: unknown) => {
          ops.push({ op: 'update', data: row, eqs: { [col1]: val1 } });
          return {
            eq: () => ({ is: async () => ({ error: null }) }),
            is: async () => ({ error: null }),
          };
        },
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

describe('deleteNotification', () => {
  it('rejects missing id', async () => {
    const { ctx } = mockCtx();
    const r = await deleteNotification(ctx, { notificationId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('deletes by id and redirects to /notifications', async () => {
    const { ctx, ops } = mockCtx();
    const r = await deleteNotification(ctx, { notificationId: 'n1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toBe('/notifications');
    // Scopes the delete to both the id AND the owner (defense-in-depth).
    expect(ops[0]).toEqual({ op: 'delete', eqs: { id: 'n1', user_id: 'u1' } });
  });
});

describe('updatePreferences', () => {
  it('rejects when no valid keys are present', async () => {
    const { ctx } = mockCtx();
    const r = await updatePreferences(ctx, { not_a_pref: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('filters out invalid keys and non-boolean values', async () => {
    const { ctx, ops } = mockCtx();
    const r = await updatePreferences(ctx, {
      email_new_offer: true,
      bogus_key: true,
      push_enabled: 'yes',         // non-boolean — dropped
      email_offer_accepted: false, // valid
    });
    expect(r.ok).toBe(true);
    expect(ops[0].data).toMatchObject({
      user_id: 'u1',
      email_new_offer: true,
      email_offer_accepted: false,
    });
    expect(ops[0].data).not.toHaveProperty('bogus_key');
    expect(ops[0].data).not.toHaveProperty('push_enabled');
  });

  it('surfaces upsert errors as server_error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx } = mockCtx({ upsertError: { message: 'pg error' } });
    const r = await updatePreferences(ctx, { email_new_offer: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('server_error');
    spy.mockRestore();
  });
});

describe('markRead', () => {
  it('rejects missing id', async () => {
    const r = await markRead(mockCtx().ctx, { id: '' });
    expect(r.ok).toBe(false);
  });

  it('updates read_at and returns ok', async () => {
    const { ctx, ops } = mockCtx();
    const r = await markRead(ctx, { id: 'n1' });
    expect(r.ok).toBe(true);
    expect(ops[0].op).toBe('update');
    expect((ops[0].data as Record<string, unknown>).read_at).toBeTypeOf('string');
  });
});

describe('markAllRead', () => {
  it('redirects to the referer when safe', async () => {
    const { ctx } = mockCtx();
    const r = await markAllRead(ctx, { referer: '/inbox' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toBe('/inbox');
  });

  it('rejects protocol-relative URLs and falls back to /notifications', async () => {
    const r = await markAllRead(mockCtx().ctx, { referer: '//evil.com/foo' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toBe('/notifications');
  });

  it('rejects non-absolute paths', async () => {
    const r = await markAllRead(mockCtx().ctx, { referer: 'evil.com' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toBe('/notifications');
  });

  it('defaults to /notifications when no referer', async () => {
    const r = await markAllRead(mockCtx().ctx, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toBe('/notifications');
  });
});
