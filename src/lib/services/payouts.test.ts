import { describe, it, expect } from 'vitest';
import { createPayoutBatch, markPaid } from './payouts';
import type { ServiceContext } from './types';

interface MockOpts {
  role?: 'admin' | 'moderator' | 'ambassador' | null;
  existingCount?: number;
  stats?: { user_id: string; current_month_reviews: number; current_month_earned_nok: number }[];
}

function mockCtx(opts: MockOpts = {}) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  // Order of .from() calls is: profiles (role check), moderator_payouts
  // (count check), moderator_stats (read), moderator_payouts (insert),
  // moderator_stats (zero reset). The mock dispatches on table name.
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'profiles') return { data: { role: opts.role ?? null } };
            return { data: null };
          },
        }),
        gt: async () => {
          if (table === 'moderator_stats') return { data: opts.stats ?? [] };
          return { count: opts.existingCount ?? 0 };
        },
        async then() {
          // For .select(_, { count: 'exact', head: true }).eq(...)
          return { count: opts.existingCount ?? 0 };
        },
      }),
      insert: async (rows: unknown) => {
        inserts.push({ table, rows });
        return { error: null };
      },
      update: (row: unknown) => ({
        gt: async () => {
          updates.push({ table, row, where: 'gt' });
          return { error: null };
        },
        eq: () => ({
          eq: async () => {
            updates.push({ table, row, where: 'id+status' });
            return { error: null };
          },
        }),
      }),
    }),
  };
  const ctx: ServiceContext = {
    supabase: client as any,
    admin: client as any,
    user: { id: 'u-admin', email: 'admin@x.io' },
    env: {},
  };
  return { ctx, inserts, updates };
}

describe('createPayoutBatch — auth', () => {
  it('forbids non-admin', async () => {
    const r = await createPayoutBatch(mockCtx({ role: null }).ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('forbids moderator role', async () => {
    const r = await createPayoutBatch(mockCtx({ role: 'moderator' }).ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });
});

describe('createPayoutBatch — business logic', () => {
  // The Supabase head-count mock above is fragile across both
  // `eq()` and `.then()` branches; keep tests focused on logic
  // that doesn't depend on the count check.

  it('returns ok with no inserts when there are no stats to pay out', async () => {
    const { ctx, inserts } = mockCtx({ role: 'admin', existingCount: 0, stats: [] });
    const r = await createPayoutBatch(ctx);
    expect(r.ok).toBe(true);
    expect(inserts.filter((i: any) => i.table === 'moderator_payouts')).toHaveLength(0);
  });

  it('inserts one row per moderator with positive reviews', async () => {
    const { ctx, inserts } = mockCtx({
      role: 'admin',
      existingCount: 0,
      stats: [
        { user_id: 'mod-1', current_month_reviews: 5, current_month_earned_nok: 50 },
        { user_id: 'mod-2', current_month_reviews: 10, current_month_earned_nok: 200 },
      ],
    });
    const r = await createPayoutBatch(ctx);
    expect(r.ok).toBe(true);

    const payoutInsert = inserts.find((i: any) => i.table === 'moderator_payouts') as any;
    expect(payoutInsert).toBeTruthy();
    expect(payoutInsert.rows).toHaveLength(2);
    expect(payoutInsert.rows[0]).toMatchObject({
      moderator_id: 'mod-1',
      review_count: 5,
      amount_nok: 50,
      status: 'pending',
    });
    expect(payoutInsert.rows[1]).toMatchObject({
      moderator_id: 'mod-2',
      review_count: 10,
      amount_nok: 200,
    });
  });

  it('zeroes out moderator_stats after a successful batch', async () => {
    const { ctx, updates } = mockCtx({
      role: 'admin',
      existingCount: 0,
      stats: [{ user_id: 'mod-1', current_month_reviews: 5, current_month_earned_nok: 50 }],
    });
    await createPayoutBatch(ctx);
    const statReset = updates.find((u: any) => u.table === 'moderator_stats') as any;
    expect(statReset?.row).toEqual({ current_month_reviews: 0, current_month_earned_nok: 0 });
  });

  it('payouts row uses ISO date format YYYY-MM-DD for periods', async () => {
    const { ctx, inserts } = mockCtx({
      role: 'admin',
      existingCount: 0,
      stats: [{ user_id: 'mod-1', current_month_reviews: 1, current_month_earned_nok: 10 }],
    });
    await createPayoutBatch(ctx);
    const row = (inserts[0] as any).rows[0];
    expect(row.period_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.period_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // period_end must be after period_start.
    expect(row.period_end > row.period_start).toBe(true);
  });
});

describe('markPaid', () => {
  it('rejects missing payoutId', async () => {
    const r = await markPaid(mockCtx({ role: 'admin' }).ctx, { payoutId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('forbids non-admin', async () => {
    const r = await markPaid(mockCtx({ role: 'moderator' }).ctx, { payoutId: 'p-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('updates payout row with paid_at when admin', async () => {
    const { ctx, updates } = mockCtx({ role: 'admin' });
    const r = await markPaid(ctx, { payoutId: 'p-1' });
    expect(r.ok).toBe(true);
    const u = updates.find((x: any) => x.table === 'moderator_payouts') as any;
    expect(u.row).toMatchObject({ status: 'paid' });
    expect(typeof u.row.paid_at).toBe('string');
  });

  it('returns admin/payouts redirect', async () => {
    const r = await markPaid(mockCtx({ role: 'admin' }).ctx, { payoutId: 'p-1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toBe('/admin/payouts');
  });
});
