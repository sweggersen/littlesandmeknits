-- Vipps Login: store the stable subject identifier from the Vipps ID token
-- so repeat logins look up the same user without going through email.
-- Email can change in the Vipps profile; sub is stable per merchant.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vipps_sub text UNIQUE,
  ADD COLUMN IF NOT EXISTS vipps_phone_e164 text;

CREATE INDEX IF NOT EXISTS idx_profiles_vipps_sub
  ON public.profiles(vipps_sub)
  WHERE vipps_sub IS NOT NULL;
