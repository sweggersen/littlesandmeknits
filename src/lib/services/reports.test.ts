import { describe, it, expect, vi } from 'vitest';
import { submitReport } from './reports';
import type { ServiceContext } from './types';

vi.mock('../notify', () => ({
  createNotification: vi.fn(),
}));

function mockCtx(opts?: {
  existingCount?: number;
  insertError?: { message: string } | null;
  openCount?: number;
  mods?: { id: string }[];
  quotaUsed?: number;
}) {
  const inserts: unknown[] = [];
  // Order-sensitive: first select() is the "already_reported" check,
  // second is the openCount check.
  let selectCall = 0;
  const client = {
    from: (table: string) => {
      // assertWithinQuota (report_create): read user_action_counts then upsert.
      if (table === 'user_action_counts') {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: { count: opts?.quotaUsed ?? 0 } }),
          upsert: async () => ({ error: null }),
        };
        return q;
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: async () => {
                selectCall++;
                if (selectCall === 1) return { count: opts?.existingCount ?? 0 };
                return { count: opts?.openCount ?? 1 };
              },
            }),
          }),
          in: async () => ({ data: opts?.mods ?? [] }),
        }),
        insert: async (row: unknown) => {
          inserts.push({ table, row });
          return { error: opts?.insertError ?? null };
        },
      };
    },
  };
  const ctx: ServiceContext = {
    supabase: client as any,
    admin: client as any,
    user: { id: 'u1', email: 'x@y.io' },
    env: {},
  };
  return { ctx, inserts };
}

const validUuid = '11111111-2222-3333-4444-555555555555';

describe('submitReport — input validation', () => {
  it('rejects an unknown target_type', async () => {
    const r = await submitReport(mockCtx().ctx, {
      targetType: 'comment', targetId: validUuid, reason: 'scam',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects a non-UUID target_id', async () => {
    const r = await submitReport(mockCtx().ctx, {
      targetType: 'listing', targetId: 'not-a-uuid', reason: 'scam',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown reasons', async () => {
    const r = await submitReport(mockCtx().ctx, {
      targetType: 'listing', targetId: validUuid, reason: 'idk',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects empty fields', async () => {
    const r = await submitReport(mockCtx().ctx, {
      targetType: '', targetId: '', reason: '',
    });
    expect(r.ok).toBe(false);
  });
});

describe('submitReport — happy path', () => {
  it('enforces the daily report quota', async () => {
    // report_create limit is 20/day; simulate already at the limit.
    const { ctx, inserts } = mockCtx({ quotaUsed: 20 });
    const r = await submitReport(ctx, {
      targetType: 'listing', targetId: validUuid, reason: 'inappropriate',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict'); // quota returns 'conflict'
    expect(inserts.find((i: any) => i.table === 'reports')).toBeUndefined();
  });

  it('inserts the report row when input is valid', async () => {
    const { ctx, inserts } = mockCtx({ existingCount: 0 });
    const r = await submitReport(ctx, {
      targetType: 'listing', targetId: validUuid, reason: 'inappropriate',
      description: 'why', anonymous: true,
    });
    expect(r.ok).toBe(true);
    const reportInsert = inserts.find((i: any) => i.table === 'reports');
    expect(reportInsert).toBeTruthy();
    expect((reportInsert as any).row).toMatchObject({
      reporter_id: 'u1',
      target_type: 'listing',
      target_id: validUuid,
      reason: 'inappropriate',
      description: 'why',
      anonymous: true,
    });
  });

  it('returns conflict when the user has already reported this target', async () => {
    const { ctx } = mockCtx({ existingCount: 1 });
    const r = await submitReport(ctx, {
      targetType: 'listing', targetId: validUuid, reason: 'scam',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('conflict');
      expect(r.message).toBe('already_reported');
    }
  });

  it('surfaces insert errors as server_error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx } = mockCtx({ existingCount: 0, insertError: { message: 'pg blew up' } });
    const r = await submitReport(ctx, {
      targetType: 'listing', targetId: validUuid, reason: 'scam',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('server_error');
    spy.mockRestore();
  });
});
