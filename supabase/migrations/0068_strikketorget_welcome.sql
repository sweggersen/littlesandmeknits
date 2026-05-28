-- Strikketorget welcome flow: gates the one-time marketplace welcome
-- screen, separate from the existing studio onboarding (welcomed_at).
-- Also captures coarse interest signals for recommendations.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS strikketorget_welcomed_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketplace_interests text[];
