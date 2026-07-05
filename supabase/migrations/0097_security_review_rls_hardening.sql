-- Adversarial security review (2026-07) — RLS WITH CHECK gaps.
--
-- Root cause (all three): the 0085 blanket `GRANT ... TO authenticated` makes
-- RLS the SOLE server-side gate for direct PostgREST calls (anon key + a user's
-- JWT). Several policies were written USING-only or with a partial WITH CHECK,
-- trusting the service layer to enforce column-level rules that a PostgREST
-- caller skips entirely. `profiles` and the commission tables were hardened this
-- way in 0038; `seller_profiles`, `store_members` and `listings` were not.
--
-- The app itself writes all three tables via the SERVICE-ROLE client (which
-- bypasses RLS), so tightening the authenticated-role policies below does not
-- change any legitimate app path — it only closes the direct-PostgREST holes.

------------------------------------------------------------
-- 1. seller_profiles — prevent self-attested "verified" seller (HIGH)
--
-- 0072 moved stripe_connect_status / stripe_onboarded / stripe_account_id /
-- seller_verified_at out of profiles (where 0038 had pinned the equivalents as
-- CRITICAL) into seller_profiles, and recreated the owner UPDATE/INSERT policies
-- WITHOUT the column pinning. So any authenticated user could
--   PATCH /rest/v1/seller_profiles?id=eq.<self>
--     {"stripe_connect_status":"verified","stripe_onboarded":true,...}
-- (or INSERT a pre-verified row) and self-attest verification — inflating trust
-- score (=> moderation auto-approval), spoofing the "verified seller" badge, and
-- bypassing the purchase onboarding gate. These are webhook-controlled fields.
------------------------------------------------------------
-- A WITH CHECK that subqueries the SAME table re-triggers that table's RLS
-- policies and Postgres rejects it as infinite recursion (42P17). Read the
-- current row through a SECURITY DEFINER helper (bypasses RLS) instead. Returns
-- true only if the NEW values for the pinned columns equal the stored ones.
CREATE OR REPLACE FUNCTION public.seller_profile_locked_unchanged(
  p_id uuid, p_account text, p_status text, p_reqs jsonb, p_onboarded boolean, p_verified timestamptz
) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE((
    SELECT p_account    IS NOT DISTINCT FROM s.stripe_account_id
       AND p_status     IS NOT DISTINCT FROM s.stripe_connect_status
       AND p_reqs       IS NOT DISTINCT FROM s.stripe_connect_requirements
       AND p_onboarded  IS NOT DISTINCT FROM s.stripe_onboarded
       AND p_verified   IS NOT DISTINCT FROM s.seller_verified_at
    FROM public.seller_profiles s WHERE s.id = p_id
  ), false)
$$;
REVOKE ALL ON FUNCTION public.seller_profile_locked_unchanged(uuid, text, text, jsonb, boolean, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.seller_profile_locked_unchanged(uuid, text, text, jsonb, boolean, timestamptz) TO authenticated;

DROP POLICY IF EXISTS "Owner updates own seller_profile" ON public.seller_profiles;
CREATE POLICY "Owner updates own seller_profile"
  ON public.seller_profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND public.seller_profile_locked_unchanged(
      id, stripe_account_id, stripe_connect_status, stripe_connect_requirements,
      stripe_onboarded, seller_verified_at)
  );

-- INSERT: a user-created row must carry the SAFE defaults for the sensitive
-- fields (no pre-verified insert). The real values only ever arrive via the
-- service-role upsert + the Stripe webhook.
DROP POLICY IF EXISTS "Owner inserts own seller_profile" ON public.seller_profiles;
CREATE POLICY "Owner inserts own seller_profile"
  ON public.seller_profiles FOR INSERT
  WITH CHECK (
    auth.uid() = id
    AND stripe_account_id IS NULL
    AND stripe_connect_status = 'pending'
    AND stripe_onboarded = false
    AND seller_verified_at IS NULL
    AND stripe_connect_requirements IS NULL
  );

------------------------------------------------------------
-- 2. store_members — prevent store-admin self-promotion to owner (MED)
--
-- 0047's `store_members_modify_admin` was `FOR ALL USING
-- (has_store_min_role(store_id,'admin'))` with no WITH CHECK, so any store
-- ADMIN could PATCH their own row to role='owner' (the new row still satisfies
-- 'admin'), or DELETE the real owners — a hostile store takeover, bypassing the
-- service's canAssignRole + last-owner protection. The app performs ALL
-- store_members writes via the service-role client, so authenticated direct
-- writes are never needed: restrict them to OWNERS only. (Reads stay covered by
-- store_members_select_same_store.)
------------------------------------------------------------
DROP POLICY IF EXISTS "store_members_modify_admin" ON public.store_members;
CREATE POLICY "store_members_modify_owner"
  ON public.store_members FOR ALL
  USING (public.has_store_min_role(store_id, 'owner'))
  WITH CHECK (public.has_store_min_role(store_id, 'owner'));

------------------------------------------------------------
-- 3. listings — pin ownership + escrow fields on seller UPDATE (MED)
--
-- 0012's WITH CHECK only guarded the active-status self-approval. Because a
-- WITH CHECK is used INSTEAD OF the USING clause for the NEW row, seller_id was
-- unconstrained on the new row, so a seller could
--   PATCH /rest/v1/listings?id=eq.<mine> {"seller_id":"<victim>"}
-- to dump a policy-violating listing onto a victim (report auto-hide + trust
-- penalties land on them), or set buyer_id / an escrow status the money
-- state-machine owns. Add: new row must still belong to the seller; buyer_id is
-- immutable here (escrow-only); and a seller can't push a row INTO an escrow
-- status (but may keep an existing one, so ordinary edits of an in-escrow
-- listing don't break).
------------------------------------------------------------
-- Same self-subquery recursion caveat as seller_profiles above: read the
-- current row via a SECURITY DEFINER helper. Returns true only when the seller's
-- NEW row keeps buyer_id, respects the moderation gate (no self-approve to
-- active), and doesn't transition INTO an escrow status.
CREATE OR REPLACE FUNCTION public.listing_seller_update_ok(
  p_id uuid, p_new_buyer uuid, p_new_status public.listing_status
) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE((
    SELECT p_new_buyer IS NOT DISTINCT FROM l.buyer_id
       AND (p_new_status <> 'active' OR l.status = 'active')
       AND (p_new_status NOT IN ('reserved', 'shipped', 'sold', 'disputed')
            OR p_new_status IS NOT DISTINCT FROM l.status)
    FROM public.listings l WHERE l.id = p_id
  ), false)
$$;
REVOKE ALL ON FUNCTION public.listing_seller_update_ok(uuid, uuid, public.listing_status) FROM public;
GRANT EXECUTE ON FUNCTION public.listing_seller_update_ok(uuid, uuid, public.listing_status) TO authenticated;

DROP POLICY IF EXISTS "Seller updates own listings" ON public.listings;
CREATE POLICY "Seller updates own listings"
  ON public.listings FOR UPDATE
  USING (auth.uid() = seller_id)
  WITH CHECK (
    auth.uid() = seller_id
    AND public.listing_seller_update_ok(id, buyer_id, status)
  );

------------------------------------------------------------
-- 4. listing_impressions — close the unauthenticated unbounded-write hole (MED)
--
-- 0043 shipped `FOR INSERT WITH CHECK (true)` (the only such policy in the
-- schema) plus the anon INSERT grant. The public anon key therefore let anyone
-- POST arbitrary volumes of impression rows directly (table bloat / quota
-- burn, and CTR-analytics poisoning with promoted/clicked=true on any listing).
-- Constrain the insert: the row must reference a real listing and, when a
-- viewer_id is supplied, it must be the caller. Logged-out impressions
-- (viewer_id NULL) are still allowed but must point at an existing listing, so
-- the write can't be a pure fabrication and abuse now needs valid listing ids.
------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can insert impressions" ON public.listing_impressions;
CREATE POLICY "Insert impressions for real listings"
  ON public.listing_impressions FOR INSERT
  WITH CHECK (
    (viewer_id IS NULL OR viewer_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_id)
  );
