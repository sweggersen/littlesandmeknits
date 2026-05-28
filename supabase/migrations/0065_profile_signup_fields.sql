-- Richer signup: collect first/last name + marketing consent timestamp.
-- display_name is kept as the public, freely-editable name (auto-composed
-- as first + last at signup; user can override later).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz;

-- Helpful for "consented to marketing" filters when sending newsletters.
CREATE INDEX IF NOT EXISTS idx_profiles_marketing_consent
  ON public.profiles(marketing_consent_at)
  WHERE marketing_consent_at IS NOT NULL;
