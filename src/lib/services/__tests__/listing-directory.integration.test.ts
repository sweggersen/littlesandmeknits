// Integration test for the listing "Nærmest" sort (migration 0110), against a
// real local Postgres. Seeds listings with coarse coords + a located buyer and
// asserts distance ordering + chips. Skipped cleanly when Supabase is down.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runListingDirectory } from '../listing-directory';

const ENV: Record<string, string | undefined> = ((typeof process !== 'undefined' && process.env) || {}) as Record<string, string | undefined>;
const SUPABASE_URL = ENV.PUBLIC_SUPABASE_URL ?? (import.meta as any).env?.PUBLIC_SUPABASE_URL;
const ANON_KEY = ENV.PUBLIC_SUPABASE_ANON_KEY ?? (import.meta as any).env?.PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = (() => { try { return (process as any)?.env?.SUPABASE_SERVICE_ROLE_KEY; } catch { return undefined; } })();
const HAS_LOCAL = !!(SUPABASE_URL && ANON_KEY && SERVICE_KEY);

const OSLO = { lat: 59.913, lng: 10.739 };
const BERGEN = { lat: 60.39, lng: 5.32 };
const TITLE_NEAR = 'ld-test-near-oslo';
const TITLE_FAR = 'ld-test-far-bergen';

describe.skipIf(!HAS_LOCAL)('listing directory — Nærmest (integration)', () => {
  let admin: SupabaseClient;
  let viewerId: string;
  let viewerClient: SupabaseClient;

  async function ensureUser(email: string): Promise<string> {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: 'rls-test-pwd' });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    return data.user.id;
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!);
    viewerId = await ensureUser('ld-viewer@test.strikketorget.no');
    const c = createClient(SUPABASE_URL!, ANON_KEY!);
    await c.auth.signInWithPassword({ email: 'ld-viewer@test.strikketorget.no', password: 'rls-test-pwd' });
    viewerClient = c;

    // Clean prior test rows.
    await admin.from('listings').delete().eq('seller_id', viewerId).in('title', [TITLE_NEAR, TITLE_FAR]);

    const now = new Date().toISOString();
    const base = { seller_id: viewerId, kind: 'pre_loved', condition: 'brukt', category: 'genser', size_label: 'M', status: 'active', published_at: now };
    const { error } = await admin.from('listings').insert([
      { ...base, title: TITLE_NEAR, price_nok: 100, lat: OSLO.lat, lng: OSLO.lng, geocoded_at: now },
      { ...base, title: TITLE_FAR, price_nok: 100, lat: BERGEN.lat, lng: BERGEN.lng, geocoded_at: now },
    ]);
    if (error) throw new Error(`seed listings failed: ${error.message}`);
  }, 60_000);

  const onlyTest = <T extends { title: string }>(rows: T[]) => rows.filter((r) => [TITLE_NEAR, TITLE_FAR].includes(r.title));

  it('located buyer: "naer" orders near-before-far and annotates distance', async () => {
    // Give the viewer Oslo coords.
    await admin.from('seller_profiles').upsert({ id: viewerId, lat: OSLO.lat, lng: OSLO.lng });

    const r = await runListingDirectory({ supabase: viewerClient as any, user: { id: viewerId } }, { kind: 'pre_loved', sort: 'naer', pageSize: 48 });
    expect(r.located).toBe(true);
    const rows = onlyTest(r.listings);
    const near = rows.find((l) => l.title === TITLE_NEAR)!;
    const far = rows.find((l) => l.title === TITLE_FAR)!;
    expect(near.distanceKm!).toBeLessThan(far.distanceKm!);
    expect(near.distanceKm!).toBeLessThan(5);
    expect(far.distanceKm!).toBeGreaterThan(250);
    expect(rows.map((l) => l.title).indexOf(TITLE_NEAR)).toBeLessThan(rows.map((l) => l.title).indexOf(TITLE_FAR));
  });

  it('unlocated buyer: not located, no distances, "naer" degrades gracefully', async () => {
    // Remove the viewer's coords.
    await admin.from('seller_profiles').upsert({ id: viewerId, lat: null, lng: null });

    const r = await runListingDirectory({ supabase: viewerClient as any, user: { id: viewerId } }, { kind: 'pre_loved', sort: 'naer', pageSize: 48 });
    expect(r.located).toBe(false);
    expect(onlyTest(r.listings).every((l) => l.distanceKm === null)).toBe(true);
    // Still returns the listings (fell back to newest).
    expect(onlyTest(r.listings).length).toBe(2);
  });
});
