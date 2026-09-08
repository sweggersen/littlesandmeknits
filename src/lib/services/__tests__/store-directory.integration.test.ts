// Integration tests for the Butikker store directory (migration 0109), run
// against a real local Postgres so triggers, RLS, and the multi-order/keyset
// query all execute for real. Skipped cleanly when Supabase is down.
//
// Covers: trigger-maintained stats, listStores sorts/filters/recommended/
// new-listing dot/distance, the favourite toggle + markStoreSeen, and the
// security invariants (favourites own-rows, featured pin, private address).

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { listStores } from '../store-directory';
import { toggleStoreFavorite, markStoreSeen } from '../store-favorites';

const ENV: Record<string, string | undefined> = ((typeof process !== 'undefined' && process.env) || {}) as Record<string, string | undefined>;
const SUPABASE_URL = ENV.PUBLIC_SUPABASE_URL ?? (import.meta as any).env?.PUBLIC_SUPABASE_URL;
const ANON_KEY = ENV.PUBLIC_SUPABASE_ANON_KEY ?? (import.meta as any).env?.PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = (() => { try { return (process as any)?.env?.SUPABASE_SERVICE_ROLE_KEY; } catch { return undefined; } })();
const HAS_LOCAL = !!(SUPABASE_URL && ANON_KEY && SERVICE_KEY);

const PWD = 'rls-test-pwd';
const OSLO = { lat: 59.913, lng: 10.739 };
const BERGEN = { lat: 60.39, lng: 5.32 };

// Fixed slugs so a rerun replaces prior state deterministically.
const SLUG_A = 'sd-test-a-featured';
const SLUG_B = 'sd-test-b-bergen';
const SLUG_C = 'sd-test-c-oslo';

describe.skipIf(!HAS_LOCAL)('store directory (integration)', () => {
  let admin: SupabaseClient;
  let ownerId: string, buyerId: string, strangerId: string;
  let buyerClient: SupabaseClient, ownerClient: SupabaseClient, strangerClient: SupabaseClient;
  let storeA: string, storeB: string, storeC: string;

  async function ensureUser(email: string): Promise<string> {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: PWD });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    return data.user.id;
  }
  async function userClient(email: string): Promise<SupabaseClient> {
    const c = createClient(SUPABASE_URL!, ANON_KEY!);
    const { error } = await c.auth.signInWithPassword({ email, password: PWD });
    if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
    return c;
  }

  async function seedStore(slug: string, over: Record<string, unknown>): Promise<string> {
    const { data, error } = await admin.from('stores').insert({
      slug, name: slug, status: 'active', created_by: ownerId,
      contact_email: 'sd@test.strikketorget.no', ...over,
    }).select('id').single();
    if (error) throw new Error(`seedStore ${slug} failed: ${error.message}`);
    return data!.id as string;
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!);
    ownerId = await ensureUser('sd-owner@test.strikketorget.no');
    buyerId = await ensureUser('sd-buyer@test.strikketorget.no');
    strangerId = await ensureUser('sd-stranger@test.strikketorget.no');

    // Clean prior test state (cascades to members/favourites/private details).
    await admin.from('stores').delete().in('slug', [SLUG_A, SLUG_B, SLUG_C]);
    await admin.from('seller_reviews').delete().eq('seller_id', ownerId);

    const now = Date.now();
    const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

    // A: Oslo, featured + verified, active listings, recent listing.
    storeA = await seedStore(SLUG_A, {
      location_city: 'Oslo', postnummer: '0150', lat: OSLO.lat, lng: OSLO.lng,
      featured: true, featured_rank: 10, verified: true,
      active_listing_count: 5, last_listing_at: iso(60_000),
    });
    // B: Bergen, plain, no active listings.
    storeB = await seedStore(SLUG_B, {
      location_city: 'Bergen', postnummer: '5003', lat: BERGEN.lat, lng: BERGEN.lng,
      active_listing_count: 0, last_listing_at: null,
    });
    // C: Oslo, plain, some active listings, older listing.
    storeC = await seedStore(SLUG_C, {
      location_city: 'Oslo', postnummer: '0560', lat: OSLO.lat, lng: OSLO.lng,
      active_listing_count: 2, last_listing_at: iso(5 * 86_400_000),
    });

    // Owner membership on A (for the private-details member-read test + pin test).
    await admin.from('store_members').insert({ store_id: storeA, user_id: ownerId, role: 'owner' });
    // Private address on A.
    await admin.from('store_private_details').insert({ store_id: storeA, precise_address: 'Testveien 1' });
    // Buyer coords (for the "Nærmest" sort).
    await admin.from('seller_profiles').upsert({ id: buyerId, lat: OSLO.lat, lng: OSLO.lng });
    // Ratings via reviews (trigger-maintained): A=5, C=3.
    await admin.from('seller_reviews').insert([
      { seller_id: ownerId, reviewer_id: buyerId, rating: 5, store_id: storeA },
      { seller_id: ownerId, reviewer_id: strangerId, rating: 3, store_id: storeC },
    ]);

    buyerClient = await userClient('sd-buyer@test.strikketorget.no');
    ownerClient = await userClient('sd-owner@test.strikketorget.no');
    strangerClient = await userClient('sd-stranger@test.strikketorget.no');
  }, 60_000);

  const ctxFor = (client: SupabaseClient, uid: string | null) => ({ supabase: client as any, user: uid ? { id: uid } : null });
  const onlyTest = (rows: Array<{ slug: string }>) => rows.filter((r) => [SLUG_A, SLUG_B, SLUG_C].includes(r.slug));

  describe('triggers', () => {
    it('recomputes rating_avg/rating_count from reviews', async () => {
      const { data } = await admin.from('stores').select('rating_avg, rating_count').eq('id', storeA).single();
      expect(Number(data!.rating_count)).toBe(1);
      expect(Number(data!.rating_avg)).toBeCloseTo(5, 2);
    });

    it('a new review updates the store rating', async () => {
      await admin.from('seller_reviews').delete().eq('store_id', storeB);
      let { data } = await admin.from('stores').select('rating_count').eq('id', storeB).single();
      expect(Number(data!.rating_count)).toBe(0);
      await admin.from('seller_reviews').insert({ seller_id: ownerId, reviewer_id: buyerId, rating: 4, store_id: storeB });
      ({ data } = await admin.from('stores').select('rating_count, rating_avg').eq('id', storeB).single());
      expect(Number(data!.rating_count)).toBe(1);
      expect(Number((data as any).rating_avg)).toBeCloseTo(4, 2);
      await admin.from('seller_reviews').delete().eq('store_id', storeB); // restore
    });
  });

  describe('listStores', () => {
    it('rating sort orders A(5) > C(3) > B(0)', async () => {
      const r = await listStores(ctxFor(buyerClient, buyerId), { sort: 'rating', pageSize: 48 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const order = onlyTest(r.data.results).map((s) => s.slug);
      expect(order.indexOf(SLUG_A)).toBeLessThan(order.indexOf(SLUG_C));
      expect(order.indexOf(SLUG_C)).toBeLessThan(order.indexOf(SLUG_B));
    });

    it('city filter narrows to Oslo stores', async () => {
      const r = await listStores(ctxFor(buyerClient, buyerId), { sort: 'nyeste', filters: { city: 'Oslo' }, pageSize: 48 });
      if (!r.ok) throw new Error('failed');
      const slugs = onlyTest(r.data.results).map((s) => s.slug);
      expect(slugs).toContain(SLUG_A);
      expect(slugs).toContain(SLUG_C);
      expect(slugs).not.toContain(SLUG_B);
    });

    it('hasActiveListings filter excludes stores with none', async () => {
      const r = await listStores(ctxFor(buyerClient, buyerId), { sort: 'nyeste', filters: { hasActiveListings: true }, pageSize: 48 });
      if (!r.ok) throw new Error('failed');
      const slugs = onlyTest(r.data.results).map((s) => s.slug);
      expect(slugs).not.toContain(SLUG_B);
      expect(slugs).toContain(SLUG_A);
    });

    it('surfaces the featured store in the recommended strip', async () => {
      // Small page so the featured store isn't already on the first results page
      // (the strip is deduped against page 1 by design).
      const r = await listStores(ctxFor(buyerClient, buyerId), { sort: 'nyeste', pageSize: 1 });
      if (!r.ok) throw new Error('failed');
      expect(r.data.recommended.some((s) => s.slug === SLUG_A && s.featured)).toBe(true);
    });

    it('located buyer gets distances; "naer" puts Oslo before Bergen', async () => {
      const r = await listStores(ctxFor(buyerClient, buyerId), { sort: 'naer', pageSize: 48 });
      if (!r.ok) throw new Error('failed');
      expect(r.data.located).toBe(true);
      const rows = onlyTest(r.data.results);
      const a = rows.find((s) => s.slug === SLUG_A)!;
      const b = rows.find((s) => s.slug === SLUG_B)!;
      expect(a.distanceKm!).toBeLessThan(b.distanceKm!);
      expect(rows.map((s) => s.slug).indexOf(SLUG_A)).toBeLessThan(rows.map((s) => s.slug).indexOf(SLUG_B));
    });

    it('anon visitor is not located and gets no distances', async () => {
      const anon = createClient(SUPABASE_URL!, ANON_KEY!);
      const r = await listStores(ctxFor(anon, null), { sort: 'anbefalt', pageSize: 48 });
      if (!r.ok) throw new Error('failed');
      expect(r.data.located).toBe(false);
      expect(onlyTest(r.data.results).every((s) => s.distanceKm === null)).toBe(true);
    });

    it('a StoreCard never carries the private address', async () => {
      const r = await listStores(ctxFor(buyerClient, buyerId), { sort: 'nyeste', pageSize: 48 });
      if (!r.ok) throw new Error('failed');
      for (const s of r.data.results) expect('precise_address' in (s as object)).toBe(false);
    });
  });

  describe('favourites + new-listing dot', () => {
    it('toggle favourites, shows the dot for a new listing, then clears on seen', async () => {
      // Fresh state.
      await admin.from('store_favorites').delete().eq('user_id', buyerId).eq('store_id', storeC);

      const t1 = await toggleStoreFavorite(ctxFor(buyerClient, buyerId) as any, storeC);
      expect(t1.ok && t1.data.favorited).toBe(true);

      // Put last_seen_at in the past and the last listing after it (but still in
      // the past) so hasNewSinceSeen is true — and markStoreSeen (now) clears it.
      await admin.from('store_favorites')
        .update({ last_seen_at: new Date(Date.now() - 2 * 86_400_000).toISOString() })
        .eq('user_id', buyerId).eq('store_id', storeC);
      await admin.from('stores')
        .update({ last_listing_at: new Date(Date.now() - 3_600_000).toISOString() }).eq('id', storeC);
      let r = await listStores(ctxFor(buyerClient, buyerId), { sort: 'nyeste', pageSize: 48 });
      if (!r.ok) throw new Error('failed');
      let c = onlyTest(r.data.results).find((s) => s.slug === SLUG_C)!;
      expect(c.isFavorite).toBe(true);
      expect(c.hasNewSinceSeen).toBe(true);

      // Opening the store bumps last_seen_at → dot clears.
      await markStoreSeen(ctxFor(buyerClient, buyerId) as any, storeC);
      r = await listStores(ctxFor(buyerClient, buyerId), { sort: 'nyeste', pageSize: 48 });
      if (!r.ok) throw new Error('failed');
      c = onlyTest(r.data.results).find((s) => s.slug === SLUG_C)!;
      expect(c.hasNewSinceSeen).toBe(false);

      // Toggle off.
      const t2 = await toggleStoreFavorite(ctxFor(buyerClient, buyerId) as any, storeC);
      expect(t2.ok && t2.data.favorited).toBe(false);
    });
  });

  describe('RLS security', () => {
    it('store_favorites: a user cannot read or write another user\'s row', async () => {
      await admin.from('store_favorites').delete().eq('user_id', buyerId).eq('store_id', storeA);
      await buyerClient.from('store_favorites').insert({ user_id: buyerId, store_id: storeA });

      // Stranger cannot see the buyer's favourite.
      const { data: seen } = await strangerClient.from('store_favorites').select('store_id').eq('user_id', buyerId);
      expect(seen ?? []).toHaveLength(0);

      // Stranger cannot insert a row on the buyer's behalf (WITH CHECK).
      const { error } = await strangerClient.from('store_favorites').insert({ user_id: buyerId, store_id: storeB });
      expect(error).not.toBeNull();

      await admin.from('store_favorites').delete().eq('user_id', buyerId).eq('store_id', storeA);
    });

    it('featured is pinned: an owner cannot self-feature via a direct update', async () => {
      // A is featured=true, rank 10. Owner tries to change it directly.
      await ownerClient.from('stores').update({ featured: false, featured_rank: 0 }).eq('id', storeA);
      const { data: afterOwner } = await admin.from('stores').select('featured, featured_rank').eq('id', storeA).single();
      expect(afterOwner!.featured).toBe(true);
      expect(Number(afterOwner!.featured_rank)).toBe(10);

      // Service-role (admin) can change it.
      await admin.from('stores').update({ featured_rank: 20 }).eq('id', storeA);
      const { data: afterAdmin } = await admin.from('stores').select('featured_rank').eq('id', storeA).single();
      expect(Number(afterAdmin!.featured_rank)).toBe(20);
      await admin.from('stores').update({ featured_rank: 10 }).eq('id', storeA); // restore
    });

    it('store_private_details: only members/staff read it, never a stranger', async () => {
      const { data: memberSees } = await ownerClient
        .from('store_private_details').select('precise_address').eq('store_id', storeA).maybeSingle();
      expect(memberSees?.precise_address).toBe('Testveien 1');

      const { data: strangerSees } = await strangerClient
        .from('store_private_details').select('precise_address').eq('store_id', storeA);
      expect(strangerSees ?? []).toHaveLength(0);
    });

    it('store_private_details: a direct caller cannot write it', async () => {
      const { error } = await strangerClient
        .from('store_private_details').insert({ store_id: storeB, precise_address: 'Hack 1' });
      expect(error).not.toBeNull();
    });
  });
});
