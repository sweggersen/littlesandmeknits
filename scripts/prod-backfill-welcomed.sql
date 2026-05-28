-- One-off backfill: stamp every existing prod profile as "already welcomed"
-- so the welcome-email feature only fires for genuinely new signups.
--
-- WHY THIS IS A SCRIPT, NOT A MIGRATION:
-- Migrations run in both local dev and prod. Locally we WANT welcomed_at to
-- start NULL so we can exercise the welcome flow (admin gallery, manual
-- signup test). On prod, we want existing users untouched on first login
-- post-deploy. So we run this once, manually, on prod before deploying
-- the welcome-email change.
--
-- HOW TO RUN:
-- 1. Open Supabase Studio → SQL editor for the production project.
-- 2. Paste this whole file and run.
-- 3. Then deploy.
--
-- IDEMPOTENT: re-running is a no-op for already-stamped rows.

UPDATE public.profiles
SET welcomed_at = now()
WHERE welcomed_at IS NULL;

-- Sanity check: should be 0 unwelcomed rows after.
SELECT count(*) AS unwelcomed_after FROM public.profiles WHERE welcomed_at IS NULL;
