// Integration tests for store follows (Butikker Phase 2), against real local
// Postgres: RLS own-rows, the "butikker du følger" feed, and the new-listing
// fanout excluding store members. Skipped cleanly when Supabase is down.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { listFollowedStoreListings } from '../store-directory';
import { notifyStoreFollowersOfNewListing } from '../../notify';

const ENV: Record<string, string | undefined> = ((typeof process !== 'undefined' && process.env) || {}) as Record<string, string | undefined>;
const SUPABASE_URL = ENV.PUBLIC_SUPABASE_URL ?? (import.meta as any).env?.PUBLIC_SUPABASE_URL;
const ANON_KEY = ENV.PUBLIC_SUPABASE_ANON_KEY ?? (import.meta as any).env?.PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = (() => { try { return (process as any)?.env?.SUPABASE_SERVICE_ROLE_KEY; } catch { return undefined; } })();
const HAS_LOCAL = !!(SUPABASE_URL && ANON_KEY && SERVICE_KEY);

const PWD = 'rls-test-pwd';
const SLUG_A = 'sf-test-a';
const SLUG_B = 'sf-test-b';

describe.skipIf(!HAS_LOCAL)('store follows (integration)', () => {
  let admin: SupabaseClient;
  let ownerId: string, followerId: string, strangerId: string;
  let followerClient: SupabaseClient, strangerClient: SupabaseClient;
  let storeA: string, storeB: string;

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
  async function seedStore(slug: string): Promise<string> {
    const { data, error } = await admin.from('stores').insert({
      slug, name: slug, status: 'active', created_by: ownerId, contact_email: 'sf@test.strikketorget.no',
    }).select('id').single();
    if (error) throw new Error(`seedStore ${slug} failed: ${error.message}`);
    return data!.id as string;
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!);
    ownerId = await ensureUser('sf-owner@test.strikketorget.no');
    followerId = await ensureUser('sf-follower@test.strikketorget.no');
    strangerId = await ensureUser('sf-stranger@test.strikketorget.no');

    await admin.from('stores').delete().in('slug', [SLUG_A, SLUG_B]);
    storeA = await seedStore(SLUG_A);
    storeB = await seedStore(SLUG_B);

    // The follower is ALSO a member of store B (to prove the fanout skips members).
    await admin.from('store_members').insert({ store_id: storeB, user_id: followerId, role: 'owner' });

    // An active listing on store A + store B.
    const now = new Date().toISOString();
    const base = { seller_id: ownerId, kind: 'ready_made', category: 'genser', size_label: 'M', status: 'active', published_at: now };
    await admin.from('listings').insert([
      { ...base, title: 'sf-listing-a', price_nok: 100, store_id: storeA },
      { ...base, title: 'sf-listing-b', price_nok: 100, store_id: storeB },
    ]);

    followerClient = await userClient('sf-follower@test.strikketorget.no');
    strangerClient = await userClient('sf-stranger@test.strikketorget.no');
  }, 60_000);

  describe('RLS', () => {
    it('a user manages only their OWN follow rows', async () => {
      await admin.from('store_follows').delete().eq('follower_id', followerId).eq('store_id', storeA);
      // Own insert works.
      const okRes = await followerClient.from('store_follows').insert({ follower_id: followerId, store_id: storeA });
      expect(okRes.error).toBeNull();
      // Forging a follow for another user is rejected (WITH CHECK).
      const badRes = await strangerClient.from('store_follows').insert({ follower_id: followerId, store_id: storeB });
      expect(badRes.error).not.toBeNull();
      // Follow counts are public-read: a stranger can see the follower's row.
      const { data: seen } = await strangerClient.from('store_follows').select('store_id').eq('follower_id', followerId);
      expect((seen ?? []).length).toBeGreaterThan(0);
    });

    it('follower_count is trigger-maintained', async () => {
      const { data } = await admin.from('stores').select('follower_count').eq('id', storeA).single();
      expect(Number(data!.follower_count)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('feed', () => {
    it('listFollowedStoreListings returns active listings from followed stores', async () => {
      // Ensure following store A.
      await admin.from('store_follows').upsert({ follower_id: followerId, store_id: storeA });
      const rows = await listFollowedStoreListings({ supabase: followerClient as any, user: { id: followerId } }, 20);
      const a = rows.find((r) => r.title === 'sf-listing-a');
      expect(a).toBeTruthy();
      expect(a!.storeName).toBe(SLUG_A);
    });

    it('is empty for an anonymous / non-following context', async () => {
      const rows = await listFollowedStoreListings({ supabase: strangerClient as any, user: { id: strangerId } }, 20);
      expect(rows.every((r) => r.title !== 'sf-listing-a')).toBe(true);
    });
  });

  describe('fanout', () => {
    it('notifies followers but NOT store members', async () => {
      // follower follows store B, but is also a MEMBER of store B → must be skipped.
      await admin.from('store_follows').upsert({ follower_id: followerId, store_id: storeB });
      // stranger follows store B, not a member → should be notified.
      await admin.from('store_follows').upsert({ follower_id: strangerId, store_id: storeB });
      await admin.from('notifications').delete().eq('type', 'store_new_listing').in('user_id', [followerId, strangerId]);

      const sent = await notifyStoreFollowersOfNewListing(admin, {
        storeId: storeB, slug: SLUG_B, listingId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        listingTitle: 'sf-listing-b', storeName: 'Butikk B',
      });

      const { data: notifs } = await admin.from('notifications')
        .select('user_id').eq('type', 'store_new_listing').in('user_id', [followerId, strangerId]);
      const notified = new Set((notifs ?? []).map((n) => n.user_id));
      expect(notified.has(strangerId)).toBe(true);   // follower, non-member → notified
      expect(notified.has(followerId)).toBe(false);  // member → skipped
      expect(sent).toBe(1);
    });
  });
});
