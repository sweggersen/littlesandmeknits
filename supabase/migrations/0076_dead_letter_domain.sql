-- R2-14 — domain tag on dead-letter events.
--
-- Today every admin / moderator sees every dead-letter row. That's fine
-- because moderation is one team. If the platform ever divides moderation
-- by surface (Strikketorget marketplace vs LMK Studio patterns), we want
-- the per-domain scoping to be a single policy change, not a backfill +
-- column add + retrofit of every recorder.
--
-- This migration:
--   1. Adds `domain text` to dead_letter_events, defaulting to 'platform'.
--   2. Backfills existing rows by prefix-matching the `service` column.
--   3. Adds a NOT NULL constraint + CHECK on the known domain set.
--   4. Leaves RLS alone — `domain` is informational today, ready to be
--      scoped tomorrow.

ALTER TABLE public.dead_letter_events
  ADD COLUMN IF NOT EXISTS domain text;

UPDATE public.dead_letter_events
SET domain = CASE
  WHEN service LIKE 'listings.%'      THEN 'marketplace'
  WHEN service LIKE 'commissions.%'   THEN 'marketplace'
  WHEN service LIKE 'conversations.%' THEN 'marketplace'
  WHEN service LIKE 'refunds.%'       THEN 'marketplace'
  WHEN service LIKE 'disputes.%'      THEN 'marketplace'
  WHEN service LIKE 'payouts.%'       THEN 'marketplace'
  WHEN service LIKE 'webhook.%'       THEN 'marketplace'
  WHEN service LIKE 'stores.%'        THEN 'marketplace'
  WHEN service LIKE 'patterns.%'      THEN 'studio'
  WHEN service LIKE 'projects.%'      THEN 'studio'
  ELSE 'platform'
END
WHERE domain IS NULL;

ALTER TABLE public.dead_letter_events
  ALTER COLUMN domain SET NOT NULL,
  ALTER COLUMN domain SET DEFAULT 'platform';

ALTER TABLE public.dead_letter_events
  ADD CONSTRAINT dead_letter_events_domain_check
  CHECK (domain IN ('marketplace', 'studio', 'platform'));

CREATE INDEX IF NOT EXISTS idx_dead_letter_events_domain_occurred
  ON public.dead_letter_events(domain, occurred_at DESC);

COMMENT ON COLUMN public.dead_letter_events.domain IS
  'Coarse routing tag. Today all staff see all rows; future RLS can scope reads by domain when moderation teams split.';
