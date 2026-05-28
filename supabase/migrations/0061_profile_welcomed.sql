-- Idempotency guard for the welcome email. Null = not yet welcomed.
-- Stamped by /api/auth/callback after the first successful login.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcomed_at timestamptz;
