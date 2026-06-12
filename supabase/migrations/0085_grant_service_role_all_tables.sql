-- 0085: Explicit grants for ALL public tables + default privileges for future ones.
--
-- 0044_explicit_grants granted anon/authenticated/service_role on every table
-- that existed at the time, but as a static per-table list. Tables created
-- afterwards (dead_letter_events 0071; seller_profiles/buyer_preferences/
-- auth_identities 0072; stores, moderation_threads, support_requests,
-- user_action_quotas, seller_follows, ...) never got explicit grants and
-- silently relied on Supabase's *implicit default privileges*.
--
-- Newer Supabase Postgres images stopped providing those implicit defaults, so
-- on a fresh apply service_role/authenticated have NO access to the post-0044
-- tables. This broke CI's RLS suite (service-role inserts → "permission denied
-- for table ..." / 42501) and is a latent prod time-bomb: the cron and Stripe
-- webhook write to dead_letter_events / seller_profiles / etc. as service_role,
-- so the next prod image upgrade would turn those writes into 500s (this is the
-- most likely root cause of the earlier cron-disabled incident).
--
-- Fix: re-assert the 0044 posture across ALL current tables and set DEFAULT
-- PRIVILEGES so every future table is covered automatically — we never hit this
-- drift again. RLS still gates every authenticated row; service_role bypasses
-- RLS by design. anon is intentionally NOT granted here, preserving the
-- 0077/0078 anti-scraping hardening (anon access stays scoped to what those
-- migrations explicitly allow).

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Cover tables created by future migrations without another grant sweep.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role, authenticated;
