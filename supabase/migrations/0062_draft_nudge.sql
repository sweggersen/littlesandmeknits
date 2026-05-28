-- Idempotency stamp for the 24h "almost there — add photos" nudge.
-- Cron checks: status='draft' AND no photos AND draft_nudge_sent_at IS NULL
-- AND created_at < now() - 24h.

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS draft_nudge_sent_at timestamptz;
