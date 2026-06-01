import { describe, it, expect, vi } from 'vitest';
import { recordDeadLetter, resolveDeadLetter } from './dead-letter';
import type { ServiceContext } from './types';

function mockCtx(insertImpl?: (row: unknown) => Promise<{ error: { message: string } | null }>): { ctx: ServiceContext; inserts: unknown[]; updates: unknown[] } {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const admin = {
    from: (_table: string) => ({
      insert: async (row: unknown) => {
        inserts.push(row);
        return insertImpl ? await insertImpl(row) : { error: null };
      },
      update: (row: unknown) => ({
        eq: async () => {
          updates.push(row);
          return { error: null };
        },
      }),
    }),
  };
  const ctx = {
    admin: admin as any,
    supabase: admin as any,
    user: { id: 'user-123', email: 'test@example.com' },
    env: {},
  } as unknown as ServiceContext;
  return { ctx, inserts, updates };
}

describe('recordDeadLetter', () => {
  it('inserts a row with the given service + context + error message', async () => {
    const { ctx, inserts } = mockCtx();
    await recordDeadLetter(ctx, {
      service: 'commissions.acceptOffer',
      context: { offer_id: 'abc' },
      error: new Error('database down'),
    });
    expect(inserts).toHaveLength(1);
    const row = inserts[0] as Record<string, unknown>;
    expect(row.service).toBe('commissions.acceptOffer');
    expect(row.user_id).toBe('user-123');
    expect(row.context).toEqual({ offer_id: 'abc' });
    expect(row.error).toBe('database down');
  });

  it('truncates very long error messages to 2000 chars', async () => {
    const { ctx, inserts } = mockCtx();
    const long = 'x'.repeat(5000);
    await recordDeadLetter(ctx, { service: 'svc', error: new Error(long) });
    expect((inserts[0] as any).error).toHaveLength(2000);
  });

  it('handles non-Error error values', async () => {
    const { ctx, inserts } = mockCtx();
    await recordDeadLetter(ctx, { service: 'svc', error: 'bare string error' });
    expect((inserts[0] as any).error).toBe('bare string error');

    await recordDeadLetter(ctx, { service: 'svc', error: { code: 'PG_001', msg: 'oops' } });
    expect((inserts[1] as any).error).toBe('{"code":"PG_001","msg":"oops"}');
  });

  it('swallows insert failures with a console.error (no throw)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx } = mockCtx(async () => {
      throw new Error('insert blew up');
    });
    await expect(
      recordDeadLetter(ctx, { service: 'svc', error: new Error('original') }),
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('null user_id when ctx.user.id is missing', async () => {
    const { ctx, inserts } = mockCtx();
    (ctx as any).user = undefined;
    await recordDeadLetter(ctx, { service: 'svc', error: 'err' });
    expect((inserts[0] as any).user_id).toBeNull();
  });
});

describe('resolveDeadLetter', () => {
  it('returns bad_input when event id is empty', async () => {
    const { ctx } = mockCtx();
    const result = await resolveDeadLetter(ctx, { eventId: '', note: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('updates resolved fields when successful', async () => {
    const { ctx, updates } = mockCtx();
    const result = await resolveDeadLetter(ctx, {
      eventId: 'evt-1',
      note: 'manually re-ran the job',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.redirect).toBe('/admin/dead-letters');
    expect(updates).toHaveLength(1);
    const u = updates[0] as Record<string, unknown>;
    expect(u.resolved_by).toBe('user-123');
    expect(u.resolution_note).toBe('manually re-ran the job');
    expect(typeof u.resolved_at).toBe('string');
  });
});
