-- Buyer-initiated refund tracking on listings. Separate from formal
-- disputes (which still use status='disputed') — these are lower-friction
-- requests that the seller can accept directly. If declined, the request
-- escalates to status='disputed' and moderator takes over.
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refund_description text,
  ADD COLUMN IF NOT EXISTS refund_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_outcome text,
  ADD COLUMN IF NOT EXISTS refund_notes text;

COMMENT ON COLUMN public.listings.refund_outcome IS
  'NULL (open), accepted (seller refunded), or declined (escalated to dispute).';
