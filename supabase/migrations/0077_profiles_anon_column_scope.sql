-- Security audit F1: profiles PII exposure to unauthenticated visitors.
--
-- The "Anyone can read profiles" policy (0012) is `using (true)`, and 0044
-- granted table-wide SELECT to `anon`. RLS is row-level, not column-level, so
-- a logged-out visitor could scrape first_name, last_name, birthday, role,
-- trust_tier/score and consent timestamps for EVERY user.
--
-- Fix: replace anon's table-wide SELECT with a column-scoped grant covering
-- only public display fields. `authenticated` and `service_role` keep full
-- SELECT (own-profile reads, server logic, the post-login welcome page that
-- reads first_name are all authenticated). Row visibility is unchanged; this
-- adds column-level least privilege for the logged-out role.
--
-- Columns intentionally withheld from anon: role, trust_score, trust_tier,
-- total_completed_transactions, total_rejections, age_confirmed_at,
-- tos_accepted_at, deleted_at, welcomed_at, first_name, last_name,
-- marketing_consent_at, birthday.

REVOKE SELECT ON public.profiles FROM anon;

GRANT SELECT (
  id,
  display_name,
  instagram_handle,
  locale,
  bio,
  location,
  avatar_path,
  seller_tags,
  profile_visible,
  created_at,
  updated_at
) ON public.profiles TO anon;
