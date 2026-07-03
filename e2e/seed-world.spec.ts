import { test, expect } from '@playwright/test';

// The world-seeder (src/lib/dev/seed-world.ts) is itself an end-to-end
// injection test: it drives every real flow — listings in all statuses,
// knitting requests through their whole lifecycle, disputes, refunds,
// moderation, reports, reviews, follows, payouts — and throws on the first
// broken step. If this passes, data can be injected correctly across the
// whole system. It also backstops the flows the per-scenario specs don't.

test('seed-world populates the whole system via real services', async ({ request }) => {
  test.setTimeout(180_000); // the seeder runs dozens of real service calls

  const token = (await (await request.get('/api/dev/test-token')).json()).token;
  const res = await request.post('/api/dev/test-exec', {
    headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
    data: { action: 'seed-world' },
  });

  const body = await res.json();
  // A broken flow returns { ok:false, error:"seed step ... failed: ..." }.
  expect(body.ok, `seed-world failed: ${body.error}`).toBe(true);

  const s = body.data.seeded as Record<string, number>;
  // Assert coverage across every entity class the seeder is responsible for.
  expect(s.listings).toBeGreaterThanOrEqual(14);
  expect(s.requests).toBeGreaterThanOrEqual(10);
  expect(s.offers).toBeGreaterThanOrEqual(6);
  expect(s.sold).toBeGreaterThanOrEqual(1);
  expect(s.reserved).toBeGreaterThanOrEqual(1);
  expect(s.disputes).toBeGreaterThanOrEqual(1);
  expect(s.refunds).toBeGreaterThanOrEqual(2);
  expect(s.moderation).toBeGreaterThanOrEqual(4);
  expect(s.completed).toBeGreaterThanOrEqual(1);
  expect(s.cancelled).toBeGreaterThanOrEqual(1);
  expect(s.reviews).toBeGreaterThanOrEqual(2);
  expect(s.reports).toBeGreaterThanOrEqual(5);
  expect(s.follows).toBeGreaterThanOrEqual(4);
  expect(s.stores).toBeGreaterThanOrEqual(1);
  expect(s.payouts).toBeGreaterThanOrEqual(1);
});
