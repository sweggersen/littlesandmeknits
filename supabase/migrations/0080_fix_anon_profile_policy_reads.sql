-- Fix a regression introduced by 0077_profiles_anon_column_scope.
--
-- 0077 replaced anon's table-wide SELECT on profiles with a column-scoped
-- grant (display columns only) to stop logged-out scraping of names/birthday/
-- role/trust. But many RLS policies on OTHER tables (listings, commission_*,
-- moderation_*, reports, dead_letter_events, ...) gate staff access with:
--     EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (...))
-- Postgres evaluates every applicable SELECT policy (they're OR'd) as the
-- querying role. For an anonymous visitor that subquery now reads a column
-- (profiles.role) anon no longer has column-level SELECT on, so the ENTIRE
-- query fails with "permission denied for table profiles" (SQLSTATE 42501).
--
-- Net effect: logged-out marketplace browsing (and any anon read of a table
-- with a staff-read policy) was broken.
--
-- Fix: grant anon column-level SELECT back on the reputation columns those
-- policies reference (role, trust_*). These are low-sensitivity, semi-public
-- signals (trust_tier already renders as public seller badges). The genuinely
-- private PII that 0077 protects — first_name, last_name, birthday,
-- marketing_consent_at, age/tos timestamps — stays revoked from anon.
--
-- (A cleaner long-term fix is a SECURITY DEFINER is_staff() helper so the
--  policies don't touch profiles columns at all under the caller's role; left
--  as a follow-up to avoid rewriting ~dozen policies in a hotfix.)

GRANT SELECT (
  role,
  trust_tier,
  trust_score,
  total_completed_transactions,
  total_rejections
) ON public.profiles TO anon;
