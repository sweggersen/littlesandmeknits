import { describe, it, expect } from 'vitest';
import { createFakeDb } from './__test_helpers__/fake-db';
import { getDashboardTrends } from './admin-stats';
import type { ServiceContext } from './types';

const DAY = 86400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function ctxFor(db: ReturnType<typeof createFakeDb>, userId = 'admin1'): ServiceContext {
  return { admin: db.client, supabase: db.client, user: { id: userId }, env: {} } as unknown as ServiceContext;
}

function seed(role = 'admin') {
  return createFakeDb({
    profiles: [
      { id: 'admin1', role, created_at: ago(100) },
      { id: 'u2', role: 'user', created_at: ago(2) },   // signup within 7d
      { id: 'u3', role: 'user', created_at: ago(10) },  // signup within 30d only
    ],
    listings: [
      { id: 'sA', status: 'sold', price_nok: 300, platform_fee_nok: 30, sold_at: ago(1) },
      { id: 'sB', status: 'sold', price_nok: 500, platform_fee_nok: 40, sold_at: ago(5) },
      { id: 'sC', status: 'sold', price_nok: 200, platform_fee_nok: 16, sold_at: ago(20) },
      { id: 'a1', status: 'active', price_nok: 100, platform_fee_nok: 0, sold_at: null },
      { id: 'd1', status: 'disputed', price_nok: 100, platform_fee_nok: 0, sold_at: null },
    ],
    commission_requests: [{ id: 'c1', status: 'disputed' }],
    dead_letter_events: [
      { id: 'dl1', resolved_at: null },
      { id: 'dl2', resolved_at: ago(3) },
    ],
  });
}

describe('getDashboardTrends', () => {
  it('refuses a non-admin/moderator', async () => {
    const r = await getDashboardTrends(ctxFor(seed('user')));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('allows moderator', async () => {
    const r = await getDashboardTrends(ctxFor(seed('moderator')));
    expect(r.ok).toBe(true);
  });

  it('aggregates GMV / revenue / counts over 7d and 30d windows', async () => {
    const r = await getDashboardTrends(ctxFor(seed('admin')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data;
    // 7d: sales sA(1d) + sB(5d); sC is 20d out.
    expect(d.sold7).toBe(2);
    expect(d.gmv7).toBe(800);
    expect(d.revenue7).toBe(70);
    // 30d: all three.
    expect(d.sold30).toBe(3);
    expect(d.gmv30).toBe(1000);
    expect(d.revenue30).toBe(86);
    // signups (admin1 is 100d, excluded).
    expect(d.signups7).toBe(1);
    expect(d.signups30).toBe(2);
    // snapshots.
    expect(d.activeListings).toBe(1);
    expect(d.openDisputes).toBe(2); // 1 listing + 1 commission
    expect(d.openDeadLetters).toBe(1); // only the unresolved one
  });

  it('buckets the 7-day sparkline (sum equals sold7)', async () => {
    const r = await getDashboardTrends(ctxFor(seed('admin')));
    if (!r.ok) return;
    expect(r.data.dailySold).toHaveLength(7);
    expect(r.data.dailySold.reduce((a, b) => a + b, 0)).toBe(r.data.sold7);
    // today index (6) had no sale; day 5 (1d ago) and day 1 (5d ago) each had one.
    expect(r.data.dailySold[5]).toBe(1);
    expect(r.data.dailySold[1]).toBe(1);
  });
});
