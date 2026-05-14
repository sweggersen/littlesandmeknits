-- Listing purchase flow + dispute resolution for both listings and commissions

-- New listing statuses for purchase flow
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'reserved' AFTER 'active';
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'shipped' AFTER 'reserved';
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'disputed';

-- New commission status for disputes
ALTER TYPE public.commission_request_status ADD VALUE IF NOT EXISTS 'disputed';

-- New notification types
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'listing_purchased';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'listing_shipped';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'listing_delivered';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'dispute_opened';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'dispute_resolved';

-- Listing purchase + dispute fields
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS buyer_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS platform_fee_nok int,
  ADD COLUMN IF NOT EXISTS reserved_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracking_code text,
  ADD COLUMN IF NOT EXISTS auto_release_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_reason text,
  ADD COLUMN IF NOT EXISTS dispute_resolution text,
  ADD COLUMN IF NOT EXISTS dispute_resolved_at timestamptz;

-- Commission dispute fields + finished item tracking
ALTER TABLE public.commission_requests
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_reason text,
  ADD COLUMN IF NOT EXISTS dispute_resolution text,
  ADD COLUMN IF NOT EXISTS dispute_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_item_tracking_code text;

-- Buyer can read their own purchased listings
CREATE POLICY "Buyer reads own purchased listings"
  ON public.listings FOR SELECT
  USING (auth.uid() = buyer_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_listings_buyer
  ON public.listings(buyer_id) WHERE buyer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_auto_release
  ON public.listings(auto_release_at) WHERE auto_release_at IS NOT NULL;
