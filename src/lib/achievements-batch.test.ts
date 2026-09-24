import { describe, it, expect, vi } from 'vitest';

// Perf batch (review-6 C): checkAndGrantAchievements now collects the keys to
// grant and does ONE batch upsert + a single summary notification when many are
// earned at once (a first-run recalc), instead of ~120 sequential insert+notify
// pairs. These lock in the batching so the cron can't blow the CF subrequest cap.

const notifications: unknown[] = [];
vi.mock('./notify', () => ({
  createNotification: vi.fn(async (_admin: unknown, n: unknown) => { notifications.push(n); }),
}));

import { checkAndGrantAchievements } from './achievements';

/** Minimal admin mock: a long-tenured profile with no prior achievements, and
 *  empty result sets for every other read — enough to earn the time-based +
 *  first-project etc. achievements. Records every user_achievements write. */
function mockAdmin() {
  const writes: Array<{ op: string; rows: unknown }> = [];
  const oldProfile = {
    created_at: new Date(Date.now() - 2000 * 86400_000).toISOString(), // ~5.5y
    avatar_path: 'a.jpg', bio: 'a bio long enough', location: 'Oslo',
    instagram_handle: '@x', trust_tier: 'trusted', role: null,
  };
  const chain = (table: string) => {
    const b: any = {
      select: () => b, eq: () => b, in: () => b, not: () => b, gte: () => b,
      order: () => b, limit: () => b,
      single: async () => ({ data: table === 'profiles' ? oldProfile : null }),
      maybeSingle: async () => ({ data: table === 'profiles' ? oldProfile : null }),
      then: (cb: (r: { data: unknown[]; count: number }) => unknown) => cb({ data: [], count: 0 }),
    };
    return b;
  };
  const admin: any = {
    from: (table: string) => ({
      ...chain(table),
      upsert: async (rows: unknown) => { writes.push({ op: 'upsert', rows }); return { error: null }; },
      insert: async (rows: unknown) => { writes.push({ op: 'insert', rows }); return { error: null }; },
    }),
  };
  return { admin, writes };
}

describe('checkAndGrantAchievements batching', () => {
  it('batch-upserts all earned achievements in ONE write and sends a single summary notification', async () => {
    notifications.length = 0;
    const { admin, writes } = mockAdmin();
    const granted = await checkAndGrantAchievements(admin, 'user-1', {});

    // Many earned at once (profile + member_30/90/180/365/730/1095 + ...).
    expect(granted.length).toBeGreaterThan(3);
    // Exactly ONE write to user_achievements (the batch), not N sequential.
    const achWrites = writes.filter((w) => w.op === 'upsert' || w.op === 'insert');
    expect(achWrites).toHaveLength(1);
    expect(Array.isArray((achWrites[0] as any).rows)).toBe(true);
    expect((achWrites[0] as any).rows).toHaveLength(granted.length);
    // One summary notification, not one per achievement.
    expect(notifications).toHaveLength(1);
    expect((notifications[0] as any).title).toContain('nye merker');
  });
});
