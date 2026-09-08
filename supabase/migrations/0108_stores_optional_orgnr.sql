-- 0108: Open stores to all sellers.
--
-- Until now a store REQUIRED a Brønnøysund-validated organisasjonsnummer, so
-- only registered businesses could have one. We now let ANY seller create a
-- store (which doubles as their public profile page). A store WITH a valid
-- org number is "verified" (blue-check); one WITHOUT is a plain personal
-- store/profile. The `verified` column and its badge UI already exist; this
-- migration only relaxes the schema, backfills the flag, and hardens the RLS.

-- 1. orgnr + legal_name become optional (NULL for personal stores).
ALTER TABLE public.stores ALTER COLUMN orgnr DROP NOT NULL;
ALTER TABLE public.stores ALTER COLUMN legal_name DROP NOT NULL;

-- The existing UNIQUE constraint on orgnr already tolerates multiple NULLs:
-- in SQL, NULLs are distinct, so any number of personal stores (orgnr IS NULL)
-- coexist without a partial-unique-index change. Business stores keep the
-- one-store-per-orgnr guarantee. No index change needed here.

-- 2. Backfill: every existing active store that carries an org number is a
--    business, so it earns the verified badge.
UPDATE public.stores
   SET verified = true
 WHERE orgnr IS NOT NULL
   AND status = 'active'
   AND deleted_at IS NULL
   AND verified IS DISTINCT FROM true;  -- idempotent-friendly no-op on re-run

-- 3. Harden the self-insert RLS.
--    The 0085 blanket `authenticated` grant means a direct PostgREST caller
--    (public anon key + a user JWT) can INSERT into stores, skipping the
--    createStore service entirely. The old policy only checked
--    `created_by = auth.uid()`, so such a caller could self-insert a row with
--    `verified = true` and `status = 'active'` — minting a fake verified,
--    live storefront. Pin the server-controlled columns: a direct caller may
--    only create an UNVERIFIED DRAFT that they own. The real service uses the
--    service-role (admin) client, which bypasses RLS, so it still inserts
--    `status = 'pending_review'` and `verified = true/false` as it decides.
DROP POLICY IF EXISTS "stores_insert_self" ON public.stores;
CREATE POLICY "stores_insert_self"
  ON public.stores FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND verified = false
    AND status = 'draft'
  );

-- 4. Refresh the now-stale COMMENTs.
COMMENT ON TABLE public.stores IS 'Stores that own listings. A store with a Brønnøysund org number is a verified business; one without is a personal store/profile page. Open to all sellers.';
COMMENT ON COLUMN public.stores.orgnr IS 'Norwegian 9-digit organisasjonsnummer from Brønnøysundregistrene. NULL for personal stores that are not tied to a registered business.';
COMMENT ON COLUMN public.stores.legal_name IS 'Canonical business name from Brønnøysund (read-only after lookup). NULL for personal stores.';
COMMENT ON COLUMN public.stores.verified IS 'Server-controlled. True when the store is backed by a valid, unique Brønnøysund org number (blue-check). Never settable by a direct PostgREST caller — see stores_insert_self.';
