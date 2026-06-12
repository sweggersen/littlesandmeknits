-- Orders extraction, final step (see docs/ORDERS_MIGRATION.md).
--
-- The purchase entity now lives entirely on `orders` (created 0088, written by
-- every service, read by every page/service). Drop the purchase columns that
-- were smeared onto the public catalog row. The listing keeps ONLY the catalog
-- projection: `status` (incl. the reserved/shipped/sold/disputed availability
-- states, written by the order services), `buyer_id` (current holder, for the
-- buyer-read RLS + isBuyer), and `sold_at` (display).
--
-- This removes the buyer-PII exposure on an anon-readable row, the money/Stripe
-- refs, and the refund/dispute/lifecycle detail. Dropping a column also drops
-- its indexes; none of the listing RLS policies reference these columns (they
-- gate on status / seller_id / buyer_id, all retained).

ALTER TABLE public.listings
  -- Buyer PII (the security driver):
  DROP COLUMN IF EXISTS buyer_name,
  DROP COLUMN IF EXISTS buyer_address,
  DROP COLUMN IF EXISTS buyer_postal_code,
  DROP COLUMN IF EXISTS buyer_city,
  -- Money + Stripe refs:
  DROP COLUMN IF EXISTS buyer_tb_fee_nok,
  DROP COLUMN IF EXISTS platform_fee_nok,
  DROP COLUMN IF EXISTS stripe_payment_intent_id,
  DROP COLUMN IF EXISTS stripe_dispute_id,
  -- Lifecycle timestamps + deadlines (the cron now reads orders):
  DROP COLUMN IF EXISTS reserved_at,
  DROP COLUMN IF EXISTS shipped_at,
  DROP COLUMN IF EXISTS tracking_code,
  DROP COLUMN IF EXISTS auto_release_at,
  DROP COLUMN IF EXISTS delivered_at,
  -- Refund sub-state:
  DROP COLUMN IF EXISTS refund_requested_at,
  DROP COLUMN IF EXISTS refund_reason,
  DROP COLUMN IF EXISTS refund_description,
  DROP COLUMN IF EXISTS refund_outcome,
  DROP COLUMN IF EXISTS refund_notes,
  DROP COLUMN IF EXISTS refund_resolved_at,
  -- Dispute sub-state:
  DROP COLUMN IF EXISTS disputed_at,
  DROP COLUMN IF EXISTS dispute_reason,
  DROP COLUMN IF EXISTS dispute_resolution,
  DROP COLUMN IF EXISTS dispute_resolved_at;
