-- Signup consent receipts + soft-delete marker on profiles.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS age_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS tos_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.profiles.age_confirmed_at IS
  'When the user confirmed they meet the minimum age requirement at signup.';
COMMENT ON COLUMN public.profiles.tos_accepted_at IS
  'When the user accepted the most recent Terms of Service / Privacy Policy.';
COMMENT ON COLUMN public.profiles.deleted_at IS
  'GDPR Art. 17 erasure timestamp. Profile is anonymised and decoupled from auth.users but the row remains for FK integrity on historical transactions.';
