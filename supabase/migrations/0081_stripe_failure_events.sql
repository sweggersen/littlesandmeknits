-- june26.md §1.2 — payments money-flow failure-mode hardening.
-- Adds webhook idempotency + correlation for chargebacks/payout failures.

-- 1. Webhook idempotency ledger. We record an event id ONLY after the event
--    has been fully processed (200), so a Stripe retry after a mid-processing
--    failure (which returns 500) still reprocesses. Service-role only.
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id     text PRIMARY KEY,
  type         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) reads/writes this.
-- The webhook is the sole accessor; anon/auth must never see it.
REVOKE ALL ON public.stripe_webhook_events FROM anon, authenticated;

-- 2. Correlate Stripe disputes (chargebacks) back to our rows, and make the
--    chargeback handler idempotent (one dispute id -> one freeze).
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS stripe_dispute_id text;
ALTER TABLE public.commission_requests
  ADD COLUMN IF NOT EXISTS stripe_dispute_id text;

CREATE INDEX IF NOT EXISTS idx_listings_stripe_dispute
  ON public.listings(stripe_dispute_id) WHERE stripe_dispute_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commissions_stripe_dispute
  ON public.commission_requests(stripe_dispute_id) WHERE stripe_dispute_id IS NOT NULL;

-- 3. New notification types for the failure paths. Reuse dispute_opened /
--    dispute_resolved for chargebacks (a chargeback is a dispute).
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'payout_failed';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'payment_failed';
