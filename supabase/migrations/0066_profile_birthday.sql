-- Optional birthday for richer personalisation. Stored as DATE because
-- we only care about Y/M/D — no timezone. Used by:
--   - The /onboarding/birthday step shown after signup
--   - Future age-bracket-aware recommendations
--   - Demographic dashboards for sellers (aggregate only)
-- Self-attested age remains the legal source of truth (18+ checkbox at signup).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birthday date;
