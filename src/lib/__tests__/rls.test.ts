// RLS policy tests. Spins up Supabase clients as different users and
// asserts what they can and can't read across protected tables.
//
// Requires a running local Supabase (or any URL set on
// PUBLIC_SUPABASE_URL with a matching service-role key in
// SUPABASE_SERVICE_ROLE_KEY env var). Skipped if neither is available.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Vitest doesn't auto-expose PUBLIC_* env vars on import.meta.env
// (that's an Astro/Vite-config thing). Read process.env first; fall
// back to import.meta.env so the file works in both contexts.
const ENV: Record<string, string | undefined> = ((typeof process !== 'undefined' && process.env) || {}) as Record<string, string | undefined>;
const SUPABASE_URL = ENV.PUBLIC_SUPABASE_URL ?? (import.meta as any).env?.PUBLIC_SUPABASE_URL as string | undefined;
const ANON_KEY = ENV.PUBLIC_SUPABASE_ANON_KEY ?? (import.meta as any).env?.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
const SERVICE_KEY = (() => {
  try {
    return (process as any)?.env?.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
  } catch {
    return undefined;
  }
})();

const HAS_LOCAL = !!(SUPABASE_URL && ANON_KEY && SERVICE_KEY);

describe.skipIf(!HAS_LOCAL)('RLS policies', () => {
  let admin: SupabaseClient;
  let aliceId: string;  // buyer
  let bobId: string;    // seller / knitter
  let charlieId: string; // third party
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let charlieClient: SupabaseClient;

  async function ensureUser(email: string): Promise<string> {
    // Idempotent: returns existing user id if email already exists.
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await admin.auth.admin.createUser({
      email, email_confirm: true, password: 'rls-test-pwd',
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    return data.user.id;
  }

  async function userClient(email: string): Promise<SupabaseClient> {
    const c = createClient(SUPABASE_URL!, ANON_KEY!);
    const { error } = await c.auth.signInWithPassword({ email, password: 'rls-test-pwd' });
    if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
    return c;
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!);

    aliceId = await ensureUser('rls-alice@test.strikketorget.no');
    bobId = await ensureUser('rls-bob@test.strikketorget.no');
    charlieId = await ensureUser('rls-charlie@test.strikketorget.no');

    aliceClient = await userClient('rls-alice@test.strikketorget.no');
    bobClient = await userClient('rls-bob@test.strikketorget.no');
    charlieClient = await userClient('rls-charlie@test.strikketorget.no');
  }, 30_000);

  describe('profiles', () => {
    it('owner can read their own profile', async () => {
      const { data, error } = await aliceClient.from('profiles').select('id').eq('id', aliceId).maybeSingle();
      expect(error).toBeNull();
      expect(data?.id).toBe(aliceId);
    });

    it('anyone can read any visible profile (display table is public-ish)', async () => {
      // profiles table has public read by default per the project's policies;
      // this test pins that behaviour so an accidental tightening surfaces.
      const { data } = await charlieClient.from('profiles').select('id').eq('id', aliceId).maybeSingle();
      expect(data?.id).toBe(aliceId);
    });
  });

  describe('dead_letter_events', () => {
    let eventId: string;

    beforeAll(async () => {
      const { data, error } = await admin.from('dead_letter_events').insert({
        service: 'rls.test',
        user_id: aliceId,
        error: 'fixture',
        context: {},
      }).select('id').single();
      if (error) throw new Error(`dead_letter_events setup insert failed: ${error.message} | code=${error.code} | details=${error.details} | hint=${error.hint}`);
      eventId = data!.id;
    });

    it('non-staff cannot read dead-letter events', async () => {
      const { data, error } = await charlieClient
        .from('dead_letter_events').select('id').eq('id', eventId);
      // RLS returns empty rather than an error for SELECT.
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it('staff can read dead-letter events', async () => {
      await admin.from('profiles').update({ role: 'admin' }).eq('id', bobId);
      const staff = await userClient('rls-bob@test.strikketorget.no');
      const { data } = await staff.from('dead_letter_events').select('id').eq('id', eventId);
      expect(data ?? []).not.toHaveLength(0);
      await admin.from('profiles').update({ role: null }).eq('id', bobId);  // restore
    });
  });

  describe('cron_heartbeats (0093)', () => {
    beforeAll(async () => {
      await admin.from('cron_heartbeats').upsert(
        { name: 'main', last_run_at: new Date().toISOString(), ok: true },
        { onConflict: 'name' },
      );
    });

    it('non-staff cannot read the cron heartbeat', async () => {
      const { data, error } = await charlieClient
        .from('cron_heartbeats').select('name').eq('name', 'main');
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it('staff read the cron heartbeat (dashboard liveness)', async () => {
      await admin.from('profiles').update({ role: 'admin' }).eq('id', bobId);
      const staff = await userClient('rls-bob@test.strikketorget.no');
      const { data } = await staff.from('cron_heartbeats').select('name').eq('name', 'main');
      expect(data ?? []).not.toHaveLength(0);
      await admin.from('profiles').update({ role: null }).eq('id', bobId);
    });

    it('authenticated users cannot write the heartbeat (service-role only)', async () => {
      const { data } = await charlieClient
        .from('cron_heartbeats')
        .update({ ok: false })
        .eq('name', 'main')
        .select('name');
      expect(data ?? []).toHaveLength(0); // no update policy -> zero rows affected
    });
  });

  describe('listings', () => {
    it('active listing is readable by any signed-in user', async () => {
      const { data: listing, error } = await admin.from('listings').insert({
        seller_id: bobId,
        title: 'rls-active', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0,
        status: 'active',
      }).select('id').single();
      if (error) throw new Error(`insert failed: ${error.message}`);
      const { data } = await charlieClient.from('listings').select('id').eq('id', listing!.id);
      expect(data ?? []).toHaveLength(1);
      await admin.from('listings').delete().eq('id', listing!.id);
    });

    it('draft listing is NOT readable by a third party', async () => {
      const { data: listing, error } = await admin.from('listings').insert({
        seller_id: bobId,
        title: 'rls-draft', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0,
        status: 'draft',
      }).select('id').single();
      if (error) throw new Error(`insert failed: ${error.message}`);
      const { data: third } = await charlieClient.from('listings').select('id').eq('id', listing!.id);
      expect(third ?? []).toHaveLength(0);
      const { data: own } = await bobClient.from('listings').select('id').eq('id', listing!.id);
      expect(own ?? []).toHaveLength(1);
      await admin.from('listings').delete().eq('id', listing!.id);
    });

    it('buyer can read their own reserved listing (purchase-flow policy)', async () => {
      const { data: listing, error } = await admin.from('listings').insert({
        seller_id: bobId,
        title: 'rls-reserved', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0,
        status: 'reserved',
        buyer_id: aliceId,
      }).select('id').single();
      if (error) throw new Error(`insert failed: ${error.message}`);
      const { data: buyer } = await aliceClient.from('listings').select('id').eq('id', listing!.id);
      expect(buyer ?? []).toHaveLength(1);
      const { data: third } = await charlieClient.from('listings').select('id').eq('id', listing!.id);
      expect(third ?? []).toHaveLength(0);
      await admin.from('listings').delete().eq('id', listing!.id);
    });

    it('store member reads a co-member\'s non-active store listing; non-member cannot (0096)', async () => {
      // Store owned by bob, charlie added as a member (manager). alice is not a
      // member. A DRAFT listing owned by bob under the store must be readable by
      // charlie (store member, not the seller) but hidden from alice.
      const slug = `rls-store-${Date.now()}`;
      const { data: store, error: sErr } = await admin.from('stores').insert({
        slug, orgnr: String(900000000 + (Date.now() % 99999999)),
        created_by: bobId, legal_name: 'RLS TEST AS', legal_address: 'Storgata 1',
        legal_business_type: 'AS', legal_status: 'aktiv', name: 'RLS Test-butikk',
        contact_email: 'rls@test.no', status: 'active',
      }).select('id').single();
      if (sErr) throw new Error(`store insert failed: ${sErr.message}`);
      await admin.from('store_members').insert([
        { store_id: store!.id, user_id: bobId, role: 'owner', visible_on_storefront: true },
        { store_id: store!.id, user_id: charlieId, role: 'manager', visible_on_storefront: true },
      ]);
      const { data: listing, error } = await admin.from('listings').insert({
        seller_id: bobId, store_id: store!.id,
        title: 'rls-store-draft', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0, status: 'draft',
      }).select('id').single();
      if (error) throw new Error(`insert failed: ${error.message}`);

      const { data: member } = await charlieClient.from('listings').select('id').eq('id', listing!.id);
      expect(member ?? []).toHaveLength(1);  // store member sees it
      const { data: nonMember } = await aliceClient.from('listings').select('id').eq('id', listing!.id);
      expect(nonMember ?? []).toHaveLength(0);  // non-member does not

      await admin.from('listings').delete().eq('id', listing!.id);
      await admin.from('store_members').delete().eq('store_id', store!.id);
      await admin.from('stores').delete().eq('id', store!.id);
    });

    // Security review 0097 #3: a seller cannot reassign a listing to a victim.
    it('seller CANNOT reassign their listing to another user (seller_id pinned)', async () => {
      const { data: listing, error } = await admin.from('listings').insert({
        seller_id: bobId, title: 'rls-reassign', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0, status: 'active',
      }).select('id').single();
      if (error) throw new Error(`insert failed: ${error.message}`);
      const { error: upErr } = await bobClient.from('listings')
        .update({ seller_id: aliceId }).eq('id', listing!.id);
      expect(upErr).not.toBeNull(); // WITH CHECK: new row must still be bob's
      const { data } = await admin.from('listings').select('seller_id').eq('id', listing!.id).maybeSingle();
      expect(data?.seller_id).toBe(bobId);
      await admin.from('listings').delete().eq('id', listing!.id);
    });

    it('seller CANNOT force an escrow status or set buyer_id on their listing', async () => {
      const { data: listing, error } = await admin.from('listings').insert({
        seller_id: bobId, title: 'rls-escrow-grief', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0, status: 'active',
      }).select('id').single();
      if (error) throw new Error(`insert failed: ${error.message}`);
      // Try to jump straight to 'sold' + claim a buyer.
      const { error: upErr } = await bobClient.from('listings')
        .update({ status: 'sold', buyer_id: charlieId }).eq('id', listing!.id);
      expect(upErr).not.toBeNull();
      const { data } = await admin.from('listings').select('status, buyer_id').eq('id', listing!.id).maybeSingle();
      expect(data?.status).toBe('active');
      expect(data?.buyer_id).toBeNull();
      await admin.from('listings').delete().eq('id', listing!.id);
    });

    it('seller CAN still edit their own active listing (price/title)', async () => {
      const { data: listing, error } = await admin.from('listings').insert({
        seller_id: bobId, title: 'rls-editable', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0, status: 'active',
      }).select('id').single();
      if (error) throw new Error(`insert failed: ${error.message}`);
      const { error: upErr } = await bobClient.from('listings')
        .update({ price_nok: 150, title: 'rls-edited' }).eq('id', listing!.id);
      expect(upErr).toBeNull();
      const { data } = await admin.from('listings').select('price_nok, title').eq('id', listing!.id).maybeSingle();
      expect(data?.price_nok).toBe(150);
      await admin.from('listings').delete().eq('id', listing!.id);
    });
  });

  // Security review 0097 #2: a store ADMIN cannot self-promote to owner or
  // remove owners directly via PostgREST (only owners may write member rows).
  describe('store_members (0097 hardening)', () => {
    let storeId: string;
    beforeAll(async () => {
      const slug = `rls-sm-${Date.now()}`;
      const { data: store, error } = await admin.from('stores').insert({
        slug, orgnr: String(910000000 + (Date.now() % 89999999)),
        created_by: bobId, legal_name: 'RLS SM AS', legal_address: 'Storgata 2',
        legal_business_type: 'AS', legal_status: 'aktiv', name: 'RLS SM-butikk',
        contact_email: 'rls-sm@test.no', status: 'active',
      }).select('id').single();
      if (error) throw new Error(`store insert failed: ${error.message}`);
      storeId = store!.id;
      // bob = owner, charlie = admin (the would-be attacker).
      await admin.from('store_members').insert([
        { store_id: storeId, user_id: bobId, role: 'owner', visible_on_storefront: true },
        { store_id: storeId, user_id: charlieId, role: 'admin', visible_on_storefront: true },
      ]);
    });

    it('store admin CANNOT promote themselves to owner', async () => {
      const { error } = await charlieClient.from('store_members')
        .update({ role: 'owner' }).eq('store_id', storeId).eq('user_id', charlieId);
      const { data } = await admin.from('store_members')
        .select('role').eq('store_id', storeId).eq('user_id', charlieId).maybeSingle();
      expect(data?.role).toBe('admin'); // unchanged
      // Either a WITH CHECK error or a no-op filtered update; role must not change.
      expect(error !== null || data?.role === 'admin').toBe(true);
    });

    it('store admin CANNOT delete the owner', async () => {
      await charlieClient.from('store_members')
        .delete().eq('store_id', storeId).eq('user_id', bobId);
      const { data } = await admin.from('store_members')
        .select('user_id').eq('store_id', storeId).eq('user_id', bobId).maybeSingle();
      expect(data?.user_id).toBe(bobId); // owner still there
    });

    afterAll(async () => {
      await admin.from('store_members').delete().eq('store_id', storeId);
      await admin.from('stores').delete().eq('id', storeId);
    });
  });

  // Security review 0097 #4: impressions can no longer be fabricated for
  // non-existent listings, and a signed-in caller can't attribute one to
  // someone else. Logged-out impressions for a REAL listing still work.
  describe('listing_impressions (0097 hardening)', () => {
    let realListingId: string;
    beforeAll(async () => {
      const { data, error } = await admin.from('listings').insert({
        seller_id: bobId, title: 'rls-impr', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0, status: 'active',
      }).select('id').single();
      if (error) throw new Error(`insert failed: ${error.message}`);
      realListingId = data!.id;
    });

    it('anon CANNOT insert an impression for a non-existent listing', async () => {
      const anon = createClient(SUPABASE_URL!, ANON_KEY!);
      const { error } = await anon.from('listing_impressions')
        .insert({ listing_id: '00000000-0000-0000-0000-000000000000', source: 'feed' });
      expect(error).not.toBeNull();
    });

    it('signed-in caller CANNOT attribute an impression to another user', async () => {
      const { error } = await charlieClient.from('listing_impressions')
        .insert({ listing_id: realListingId, source: 'feed', viewer_id: aliceId });
      expect(error).not.toBeNull();
    });

    it('logged-out impression for a real listing still works', async () => {
      const anon = createClient(SUPABASE_URL!, ANON_KEY!);
      const { error } = await anon.from('listing_impressions')
        .insert({ listing_id: realListingId, source: 'feed' });
      expect(error).toBeNull();
    });

    afterAll(async () => {
      await admin.from('listing_impressions').delete().eq('listing_id', realListingId);
      await admin.from('listings').delete().eq('id', realListingId);
    });
  });

  describe('marketplace conversations + messages', () => {
    let listingId: string;
    let convId: string;

    beforeAll(async () => {
      const { data: l, error } = await admin.from('listings').insert({
        seller_id: bobId,
        title: 'rls-msg-listing', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0,
        status: 'active',
      }).select('id').single();
      if (error) throw new Error(`msg-listing insert failed: ${error.message}`);
      listingId = l!.id;
      const { data: c } = await admin.from('marketplace_conversations').insert({
        listing_id: listingId, buyer_id: aliceId, seller_id: bobId,
      }).select('id').single();
      convId = c!.id;
      await admin.from('marketplace_messages').insert({
        conversation_id: convId, sender_id: aliceId, body: 'rls hello',
      });
    });

    it('participants see the conversation; third party does not', async () => {
      const { data: a } = await aliceClient.from('marketplace_conversations')
        .select('id').eq('id', convId);
      expect(a ?? []).toHaveLength(1);
      const { data: b } = await bobClient.from('marketplace_conversations')
        .select('id').eq('id', convId);
      expect(b ?? []).toHaveLength(1);
      const { data: c } = await charlieClient.from('marketplace_conversations')
        .select('id').eq('id', convId);
      expect(c ?? []).toHaveLength(0);
    });

    it('participants see messages; third party does not', async () => {
      const { data: a } = await aliceClient.from('marketplace_messages')
        .select('id, body').eq('conversation_id', convId);
      expect((a ?? []).length).toBeGreaterThan(0);
      const { data: c } = await charlieClient.from('marketplace_messages')
        .select('id, body').eq('conversation_id', convId);
      expect(c ?? []).toHaveLength(0);
    });

    it('third party cannot send a message into someone else conversation', async () => {
      const { error } = await charlieClient.from('marketplace_messages').insert({
        conversation_id: convId, sender_id: charlieId, body: 'intruder',
      });
      // RLS WITH CHECK violation surfaces as a row-level security error.
      expect(error).not.toBeNull();
    });
  });

  describe('commission_requests', () => {
    it('open public requests are readable by any signed-in user; private targeted ones are hidden', async () => {
      const { data: openReq, error: openErr } = await admin.from('commission_requests').insert({
        buyer_id: aliceId,
        title: 'rls open',
        category: 'genser', size_label: 'M',
        budget_nok_min: 100, budget_nok_max: 200,
        status: 'open',
      }).select('id').single();
      if (openErr) throw new Error(`open insert failed: ${openErr.message}`);
      const { data: privateReq, error: privErr } = await admin.from('commission_requests').insert({
        buyer_id: aliceId,
        title: 'rls private',
        category: 'genser', size_label: 'M',
        budget_nok_min: 100, budget_nok_max: 200,
        status: 'open',
        target_knitter_id: bobId,
      }).select('id').single();
      if (privErr) throw new Error(`private insert failed: ${privErr.message}`);

      // Third party (charlie): sees only the public open one
      const { data: charlieOpen } = await charlieClient.from('commission_requests')
        .select('id').eq('id', openReq!.id);
      expect(charlieOpen ?? []).toHaveLength(1);
      const { data: charliePrivate } = await charlieClient.from('commission_requests')
        .select('id').eq('id', privateReq!.id);
      expect(charliePrivate ?? []).toHaveLength(0);

      // Targeted knitter (bob): sees the private one
      const { data: bobPrivate } = await bobClient.from('commission_requests')
        .select('id').eq('id', privateReq!.id);
      expect(bobPrivate ?? []).toHaveLength(1);

      await admin.from('commission_requests').delete().in('id', [openReq!.id, privateReq!.id]);
    });

    it('frozen requests are hidden from non-owners', async () => {
      const { data: req } = await admin.from('commission_requests').insert({
        buyer_id: aliceId,
        title: 'rls frozen',
        category: 'genser', size_label: 'M',
        budget_nok_min: 100, budget_nok_max: 200,
        status: 'frozen',
      }).select('id').single();

      const { data: charlieReads } = await charlieClient.from('commission_requests')
        .select('id').eq('id', req!.id);
      expect(charlieReads ?? []).toHaveLength(0);

      // Owner (alice) still sees their own
      const { data: aliceReads } = await aliceClient.from('commission_requests')
        .select('id').eq('id', req!.id);
      expect(aliceReads ?? []).toHaveLength(1);

      await admin.from('commission_requests').delete().eq('id', req!.id);
    });

    it('staff (admin) read a request they are not party to (0092)', async () => {
      const { data: req } = await admin.from('commission_requests').insert({
        buyer_id: aliceId,
        title: 'rls staff-read',
        category: 'genser', size_label: 'M',
        budget_nok_min: 100, budget_nok_max: 200,
        status: 'frozen', // hidden from non-owners; staff must still read it
      }).select('id').single();

      await admin.from('profiles').update({ role: 'admin' }).eq('id', charlieId);
      const staff = await userClient('rls-charlie@test.strikketorget.no');
      const { data } = await staff.from('commission_requests').select('id').eq('id', req!.id);
      expect(data ?? []).not.toHaveLength(0);
      await admin.from('profiles').update({ role: null }).eq('id', charlieId);

      await admin.from('commission_requests').delete().eq('id', req!.id);
    });
  });

  describe('commission_offers', () => {
    it('only the offering knitter and the request buyer can read the offer', async () => {
      const { data: req } = await admin.from('commission_requests').insert({
        buyer_id: aliceId,
        title: 'rls offer-req',
        category: 'genser', size_label: 'M',
        budget_nok_min: 100, budget_nok_max: 200,
        status: 'open',
      }).select('id').single();
      const { data: offer } = await admin.from('commission_offers').insert({
        request_id: req!.id, knitter_id: bobId,
        price_nok: 150, turnaround_weeks: 2, message: 'rls',
        status: 'pending',
      }).select('id').single();

      const { data: bobReads } = await bobClient.from('commission_offers')
        .select('id').eq('id', offer!.id);
      expect(bobReads ?? []).toHaveLength(1);

      const { data: aliceReads } = await aliceClient.from('commission_offers')
        .select('id').eq('id', offer!.id);
      expect(aliceReads ?? []).toHaveLength(1);

      const { data: charlieReads } = await charlieClient.from('commission_offers')
        .select('id').eq('id', offer!.id);
      expect(charlieReads ?? []).toHaveLength(0);

      // ...but staff (admin) read any offer for moderation/receipts (0092).
      await admin.from('profiles').update({ role: 'admin' }).eq('id', charlieId);
      const staff = await userClient('rls-charlie@test.strikketorget.no');
      const { data: staffReads } = await staff.from('commission_offers').select('id').eq('id', offer!.id);
      expect(staffReads ?? []).not.toHaveLength(0);
      await admin.from('profiles').update({ role: null }).eq('id', charlieId);

      await admin.from('commission_offers').delete().eq('id', offer!.id);
      await admin.from('commission_requests').delete().eq('id', req!.id);
    });
  });

  describe('projects (commission buyer access via 0070 policy)', () => {
    it('buyer of a commission can read the linked project; third party cannot', async () => {
      // Set up: Bob (knitter) creates an offer accepted by Alice (buyer);
      // a project is linked to the offer. Charlie is unrelated.
      const { data: req } = await admin.from('commission_requests').insert({
        buyer_id: aliceId,
        title: 'RLS test commission',
        category: 'genser',
        size_label: 'M',
        budget_nok_min: 100, budget_nok_max: 200,
        status: 'open',
      }).select('id').single();
      const { data: offer } = await admin.from('commission_offers').insert({
        request_id: req!.id, knitter_id: bobId,
        price_nok: 150, turnaround_weeks: 2,
        message: 'rls',
        status: 'accepted',
      }).select('id').single();
      await admin.from('commission_requests').update({
        awarded_offer_id: offer!.id, status: 'awaiting_payment',
      }).eq('id', req!.id);
      const { data: project } = await admin.from('projects').insert({
        user_id: bobId, title: 'rls project',
        status: 'planning', commission_offer_id: offer!.id,
      }).select('id').single();

      // Alice (buyer) reads via the 0070 policy
      const { data: aliceReads } = await aliceClient.from('projects')
        .select('id').eq('id', project!.id);
      expect(aliceReads ?? []).toHaveLength(1);

      // Bob (owner/knitter) reads via the owner policy
      const { data: bobReads } = await bobClient.from('projects')
        .select('id').eq('id', project!.id);
      expect(bobReads ?? []).toHaveLength(1);

      // Charlie sees nothing
      const { data: charlieReads } = await charlieClient.from('projects')
        .select('id').eq('id', project!.id);
      expect(charlieReads ?? []).toHaveLength(0);

      // Cleanup so re-runs are idempotent
      await admin.from('projects').delete().eq('id', project!.id);
      await admin.from('commission_offers').delete().eq('id', offer!.id);
      await admin.from('commission_requests').delete().eq('id', req!.id);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Profile-split tables (migration 0072). These hold PII —
  // kontonummer, address, phone, OIDC sub — so the RLS posture is
  // owner-only + staff-for-moderation. The tests pin the boundary.
  // ──────────────────────────────────────────────────────────────

  describe('seller_profiles', () => {
    beforeAll(async () => {
      // Alice seeds a seller_profile for these tests.
      const { error } = await admin.from('seller_profiles').upsert({
        id: aliceId,
        legal_name: 'Alice Test',
        kontonummer: '12345678901',
        stripe_connect_status: 'pending',
      });
      if (error) throw new Error(`seller_profiles setup upsert failed: ${error.message} | code=${error.code} | details=${error.details} | hint=${error.hint}`);
    });

    it('owner reads own seller_profile', async () => {
      const { data } = await aliceClient.from('seller_profiles')
        .select('id, legal_name, kontonummer').eq('id', aliceId).maybeSingle();
      expect(data?.id).toBe(aliceId);
      expect(data?.kontonummer).toBe('12345678901');
    });

    it('third party CANNOT read another user\'s seller_profile', async () => {
      const { data } = await charlieClient.from('seller_profiles')
        .select('id, kontonummer').eq('id', aliceId);
      expect(data ?? []).toHaveLength(0);
    });

    it('staff (admin role) reads any seller_profile', async () => {
      await admin.from('profiles').update({ role: 'admin' }).eq('id', bobId);
      const staff = await userClient('rls-bob@test.strikketorget.no');
      const { data } = await staff.from('seller_profiles')
        .select('id, kontonummer').eq('id', aliceId);
      expect(data ?? []).not.toHaveLength(0);
      await admin.from('profiles').update({ role: null }).eq('id', bobId);
    });

    // Security review 0097 #1: owner cannot self-attest verification.
    it('owner CANNOT self-attest stripe_onboarded / verified status', async () => {
      const { error } = await aliceClient.from('seller_profiles')
        .update({ stripe_onboarded: true, stripe_connect_status: 'verified', seller_verified_at: new Date().toISOString() })
        .eq('id', aliceId);
      // The WITH CHECK rejects the write (or it is silently filtered) — either
      // way the sensitive columns must remain at their seeded values.
      const { data } = await admin.from('seller_profiles')
        .select('stripe_onboarded, stripe_connect_status, seller_verified_at').eq('id', aliceId).maybeSingle();
      expect(data?.stripe_onboarded).toBe(false);
      expect(data?.stripe_connect_status).toBe('pending');
      expect(data?.seller_verified_at).toBeNull();
      expect(error).not.toBeNull(); // RLS WITH CHECK violation surfaces as an error on UPDATE
    });

    it('owner CAN still edit their non-sensitive seller fields', async () => {
      const { error } = await aliceClient.from('seller_profiles')
        .update({ legal_name: 'Alice Renamed', city: 'Bergen' }).eq('id', aliceId);
      expect(error).toBeNull();
      const { data } = await admin.from('seller_profiles').select('legal_name, city').eq('id', aliceId).maybeSingle();
      expect(data?.legal_name).toBe('Alice Renamed');
      expect(data?.city).toBe('Bergen');
    });

    it('user CANNOT INSERT a pre-verified seller_profile', async () => {
      // charlie has no seller_profile yet; try to insert one already verified.
      const { error } = await charlieClient.from('seller_profiles')
        .insert({ id: charlieId, stripe_onboarded: true, stripe_connect_status: 'verified' });
      expect(error).not.toBeNull();
      const { data } = await admin.from('seller_profiles').select('id').eq('id', charlieId).maybeSingle();
      expect(data).toBeNull();
    });

    afterAll(async () => {
      await admin.from('seller_profiles').delete().eq('id', aliceId);
      await admin.from('seller_profiles').delete().eq('id', charlieId);
    });
  });

  describe('buyer_preferences', () => {
    beforeAll(async () => {
      const { error } = await admin.from('buyer_preferences').upsert({
        id: aliceId,
        marketplace_interests: ['children'],
        strikketorget_welcomed_at: new Date().toISOString(),
      });
      if (error) throw new Error(`buyer_preferences setup upsert failed: ${error.message} | code=${error.code} | details=${error.details} | hint=${error.hint}`);
    });

    it('owner reads own buyer_preferences', async () => {
      const { data } = await aliceClient.from('buyer_preferences')
        .select('id, marketplace_interests').eq('id', aliceId).maybeSingle();
      expect(data?.id).toBe(aliceId);
      expect(data?.marketplace_interests).toEqual(['children']);
    });

    it('third party CANNOT read another user\'s buyer_preferences', async () => {
      const { data } = await charlieClient.from('buyer_preferences')
        .select('id').eq('id', aliceId);
      expect(data ?? []).toHaveLength(0);
    });

    afterAll(async () => {
      await admin.from('buyer_preferences').delete().eq('id', aliceId);
    });
  });

  describe('dashboard_layouts (0099)', () => {
    beforeAll(async () => {
      const { error } = await admin.from('dashboard_layouts').upsert({
        user_id: aliceId,
        context: 'profile',
        layout: [{ widget: 'badges', size: 'l' }],
      });
      if (error) throw new Error(`dashboard_layouts setup upsert failed: ${error.message} | code=${error.code}`);
    });

    it('owner reads + writes own layout', async () => {
      const { error: upErr } = await aliceClient.from('dashboard_layouts').upsert({
        user_id: aliceId, context: 'profile', layout: [{ widget: 'projects', size: 'm' }],
      });
      expect(upErr).toBeNull();
      const { data } = await aliceClient.from('dashboard_layouts')
        .select('layout').eq('user_id', aliceId).eq('context', 'profile').maybeSingle();
      expect(data?.layout).toEqual([{ widget: 'projects', size: 'm' }]);
    });

    it('third party CANNOT read another user\'s layout', async () => {
      const { data } = await charlieClient.from('dashboard_layouts')
        .select('user_id').eq('user_id', aliceId);
      expect(data ?? []).toHaveLength(0);
    });

    it('user CANNOT write a layout row for another user (user_id pinned)', async () => {
      const { error } = await charlieClient.from('dashboard_layouts').insert({
        user_id: aliceId, context: 'profile', layout: [{ widget: 'x', size: 's' }],
      });
      expect(error).not.toBeNull(); // WITH CHECK rejects the foreign user_id
      // And Alice's real row is untouched.
      const { data } = await admin.from('dashboard_layouts')
        .select('layout').eq('user_id', aliceId).eq('context', 'profile').maybeSingle();
      expect(data?.layout).toEqual([{ widget: 'projects', size: 'm' }]);
    });

    afterAll(async () => {
      await admin.from('dashboard_layouts').delete().eq('user_id', aliceId);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // orders (migration 0088). The purchase entity carries buyer PII
  // (shipping address) + money fields, so the posture is: parties +
  // staff read, NOBODY writes via RLS (service-role only), zero anon.
  // ──────────────────────────────────────────────────────────────

  describe('orders', () => {
    let orderListingId: string;
    let orderId: string;

    beforeAll(async () => {
      const { data: l, error: lErr } = await admin.from('listings').insert({
        seller_id: bobId,
        title: 'rls-order-listing', description: 'x',
        price_nok: 300, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 76,
        status: 'reserved',
      }).select('id').single();
      if (lErr) throw new Error(`orders setup listing insert failed: ${lErr.message} | code=${lErr.code}`);
      orderListingId = l!.id;

      const { data: o, error: oErr } = await admin.from('orders').insert({
        listing_id: orderListingId,
        buyer_id: aliceId,
        seller_id: bobId,
        status: 'reserved',
        item_price_nok: 300, shipping_nok: 76, tb_fee_nok: 19, platform_fee_nok: 19,
        shipping_name: 'Alice Test', shipping_address: 'Hemmelig gate 1',
        shipping_postal_code: '0001', shipping_city: 'Oslo',
      }).select('id').single();
      if (oErr) throw new Error(`orders setup insert failed: ${oErr.message} | code=${oErr.code} | details=${oErr.details}`);
      orderId = o!.id;
    });

    it('buyer reads their own order (incl. the address they entered)', async () => {
      const { data } = await aliceClient.from('orders')
        .select('id, shipping_address').eq('id', orderId).maybeSingle();
      expect(data?.id).toBe(orderId);
      expect(data?.shipping_address).toBe('Hemmelig gate 1');
    });

    it('seller reads the order on their listing (they must ship to the address)', async () => {
      const { data } = await bobClient.from('orders')
        .select('id, shipping_address').eq('id', orderId).maybeSingle();
      expect(data?.id).toBe(orderId);
    });

    it('third party CANNOT read the order', async () => {
      const { data, error } = await charlieClient.from('orders')
        .select('id').eq('id', orderId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it('staff (admin role) reads any order', async () => {
      await admin.from('profiles').update({ role: 'admin' }).eq('id', charlieId);
      const staff = await userClient('rls-charlie@test.strikketorget.no');
      const { data } = await staff.from('orders').select('id').eq('id', orderId);
      expect(data ?? []).not.toHaveLength(0);
      await admin.from('profiles').update({ role: null }).eq('id', charlieId);
    });

    it('authenticated users CANNOT insert orders (service-role only)', async () => {
      const { error } = await charlieClient.from('orders').insert({
        listing_id: orderListingId, buyer_id: charlieId, seller_id: bobId,
        item_price_nok: 1,
      });
      expect(error).not.toBeNull(); // no insert policy -> RLS violation
    });

    it('even the buyer CANNOT update their own order via RLS', async () => {
      const { data } = await aliceClient.from('orders')
        .update({ status: 'delivered' })
        .eq('id', orderId)
        .select('id');
      // No update policy: zero rows match for non-service-role writers.
      expect(data ?? []).toHaveLength(0);
      const { data: still } = await admin.from('orders').select('status').eq('id', orderId).maybeSingle();
      expect(still?.status).toBe('reserved');
    });

    afterAll(async () => {
      await admin.from('orders').delete().eq('id', orderId);
      await admin.from('listings').delete().eq('id', orderListingId);
    });
  });

  describe('payment_events (money ledger)', () => {
    let eventId: string;

    beforeAll(async () => {
      // The ledger references an order id (no FK), so a bare uuid is fine.
      const { data, error } = await admin.from('payment_events').insert({
        kind: 'listing', event_type: 'reserved',
        order_id: '00000000-0000-0000-0000-000000000001',
        actor_id: aliceId, amount_nok: 300, fee_nok: 19,
        stripe_payment_intent_id: 'pi_rls', context: {},
      }).select('id').single();
      if (error) throw new Error(`payment_events setup insert failed: ${error.message} | code=${error.code} | details=${error.details} | hint=${error.hint}`);
      eventId = data!.id;
    });

    it('non-staff (even the actor) cannot read the ledger', async () => {
      // alice is the recorded actor, but the ledger is staff-only.
      const { data, error } = await aliceClient
        .from('payment_events').select('id').eq('id', eventId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it('staff (admin role) reads the ledger', async () => {
      await admin.from('profiles').update({ role: 'admin' }).eq('id', bobId);
      const staff = await userClient('rls-bob@test.strikketorget.no');
      const { data } = await staff.from('payment_events').select('id').eq('id', eventId);
      expect(data ?? []).not.toHaveLength(0);
      await admin.from('profiles').update({ role: null }).eq('id', bobId);  // restore
    });

    it('authenticated users CANNOT insert ledger rows (service-role only)', async () => {
      const { error } = await charlieClient.from('payment_events').insert({
        kind: 'listing', event_type: 'reserved',
        order_id: '00000000-0000-0000-0000-000000000002',
      });
      expect(error).not.toBeNull(); // no insert policy -> RLS violation
    });

    it('the one-entity check rejects a row with neither/both entity ids', async () => {
      // Service-role bypasses RLS, so this proves the CHECK constraint, not a policy.
      const neither = await admin.from('payment_events').insert({ kind: 'listing', event_type: 'reserved' });
      expect(neither.error).not.toBeNull();
      const both = await admin.from('payment_events').insert({
        kind: 'listing', event_type: 'reserved',
        order_id: '00000000-0000-0000-0000-000000000003',
        commission_request_id: '00000000-0000-0000-0000-000000000004',
      });
      expect(both.error).not.toBeNull();
    });

    afterAll(async () => {
      await admin.from('payment_events').delete().eq('id', eventId);
    });
  });

  describe('admin-only vs moderator staff policies (0095 consolidation)', () => {
    // 0095 rewrote inline role checks onto the helpers. These pin that the
    // admin-only tables did NOT silently widen to moderators.
    it('a moderator cannot read the audit log or payouts; an admin can', async () => {
      await admin.from('moderation_audit_log').insert({
        actor_id: aliceId, action: 'approve', target_type: 'listing',
        target_id: '00000000-0000-0000-0000-000000000001',
      });

      await admin.from('profiles').update({ role: 'moderator' }).eq('id', bobId);
      const mod = await userClient('rls-bob@test.strikketorget.no');
      const { data: modLog } = await mod.from('moderation_audit_log').select('id').limit(1);
      expect(modLog ?? []).toHaveLength(0);
      const { data: modPayouts } = await mod.from('moderator_payouts').select('id').limit(1);
      expect(modPayouts ?? []).toHaveLength(0); // none are theirs; admin-read denied

      await admin.from('profiles').update({ role: 'admin' }).eq('id', bobId);
      const adm = await userClient('rls-bob@test.strikketorget.no');
      const { data: admLog } = await adm.from('moderation_audit_log').select('id').limit(1);
      expect(admLog ?? []).not.toHaveLength(0);

      await admin.from('profiles').update({ role: null }).eq('id', bobId);
      await admin.from('moderation_audit_log').delete().eq('actor_id', aliceId);
    });
  });

  describe('staff-read moderation gaps (0094)', () => {
    let storeId: string;
    let listingId: string;
    let photoId: string;
    let convId: string;

    beforeAll(async () => {
      const { data: s, error: sErr } = await admin.from('stores').insert({
        name: 'rls-staff-store', legal_name: 'RLS Staff Store AS',
        slug: `rls-staff-store-${bobId.slice(0, 8)}`,
        orgnr: `9${String(Date.now()).slice(-8)}`, // unique-ish 9-digit test orgnr
        status: 'pending_review',
        created_by: bobId,
      }).select('id').single();
      if (sErr) throw new Error(`store insert failed: ${sErr.message} | ${sErr.details}`);
      storeId = s!.id;

      const { data: l, error: lErr } = await admin.from('listings').insert({
        seller_id: bobId, title: 'rls-staff-photos', price_nok: 100,
        kind: 'ready_made', category: 'genser', size_label: 'M',
        status: 'pending_review',
      }).select('id').single();
      if (lErr) throw new Error(`listing insert failed: ${lErr.message}`);
      listingId = l!.id;
      const { data: p, error: pErr } = await admin.from('listing_photos').insert({
        listing_id: listingId, path: 'rls/staff-test.jpg', position: 0,
      }).select('id').single();
      if (pErr) throw new Error(`photo insert failed: ${pErr.message}`);
      photoId = p!.id;

      const { data: c, error: cErr } = await admin.from('marketplace_conversations').insert({
        listing_id: listingId, buyer_id: aliceId, seller_id: bobId,
      }).select('id').single();
      if (cErr) throw new Error(`conversation insert failed: ${cErr.message}`);
      convId = c!.id;
    });

    it('third party cannot read a pending store / its photos / others\' conversations', async () => {
      const { data: s } = await charlieClient.from('stores').select('id').eq('id', storeId);
      expect(s ?? []).toHaveLength(0);
      const { data: p } = await charlieClient.from('listing_photos').select('id').eq('id', photoId);
      expect(p ?? []).toHaveLength(0);
      const { data: c } = await charlieClient.from('marketplace_conversations').select('id').eq('id', convId);
      expect(c ?? []).toHaveLength(0);
    });

    it('staff read all three (moderation + dispute context)', async () => {
      await admin.from('profiles').update({ role: 'moderator' }).eq('id', charlieId);
      const staff = await userClient('rls-charlie@test.strikketorget.no');
      const { data: s } = await staff.from('stores').select('id').eq('id', storeId);
      expect(s ?? []).not.toHaveLength(0);
      const { data: p } = await staff.from('listing_photos').select('id').eq('id', photoId);
      expect(p ?? []).not.toHaveLength(0);
      const { data: c } = await staff.from('marketplace_conversations').select('id').eq('id', convId);
      expect(c ?? []).not.toHaveLength(0);
      await admin.from('profiles').update({ role: null }).eq('id', charlieId);
    });

    afterAll(async () => {
      await admin.from('marketplace_conversations').delete().eq('id', convId);
      await admin.from('listing_photos').delete().eq('id', photoId);
      await admin.from('listings').delete().eq('id', listingId);
      await admin.from('stores').delete().eq('id', storeId);
    });
  });

  describe('auth_identities', () => {
    let identityId: string;

    beforeAll(async () => {
      const { data, error } = await admin.from('auth_identities').insert({
        user_id: aliceId,
        provider: 'vipps',
        sub: 'rls-test-sub-' + aliceId.slice(0, 8),
        phone: '+4712345678',
      }).select('id').single();
      if (error) throw new Error(`auth_identities setup insert failed: ${error.message} | code=${error.code} | details=${error.details} | hint=${error.hint}`);
      identityId = data!.id;
    });

    it('owner reads own auth_identities', async () => {
      const { data } = await aliceClient.from('auth_identities')
        .select('id, provider, sub').eq('user_id', aliceId);
      expect(data ?? []).not.toHaveLength(0);
      expect(data?.[0].provider).toBe('vipps');
    });

    it('third party CANNOT read another user\'s auth_identities', async () => {
      const { data } = await charlieClient.from('auth_identities')
        .select('id').eq('user_id', aliceId);
      expect(data ?? []).toHaveLength(0);
    });

    it('staff (admin role) reads any auth_identity (moderation needs it)', async () => {
      await admin.from('profiles').update({ role: 'admin' }).eq('id', bobId);
      const staff = await userClient('rls-bob@test.strikketorget.no');
      const { data } = await staff.from('auth_identities')
        .select('id, sub, phone').eq('user_id', aliceId);
      expect(data ?? []).not.toHaveLength(0);
      await admin.from('profiles').update({ role: null }).eq('id', bobId);
    });

    it('unique(provider, sub) blocks two users claiming the same OIDC subject', async () => {
      // Bob tries to claim Alice's vipps sub.
      const { error } = await admin.from('auth_identities').insert({
        user_id: bobId,
        provider: 'vipps',
        sub: 'rls-test-sub-' + aliceId.slice(0, 8),
        phone: '+4787654321',
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('23505'); // unique_violation
    });

    afterAll(async () => {
      await admin.from('auth_identities').delete().eq('id', identityId);
    });
  });
});
