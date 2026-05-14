-- Promoted listings + impression tracking

-- Promotion records
CREATE TABLE public.listing_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.profiles(id),
  tier text NOT NULL CHECK (tier IN ('boost', 'highlight')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  price_nok int NOT NULL,
  stripe_session_id text UNIQUE,
  stripe_payment_intent_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.listing_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sellers read own promotions" ON public.listing_promotions
  FOR SELECT USING (auth.uid() = seller_id);
CREATE INDEX idx_promotions_listing ON public.listing_promotions(listing_id, status);
CREATE INDEX idx_promotions_active ON public.listing_promotions(ends_at) WHERE status = 'active';

-- Impression/click tracking
CREATE TABLE public.listing_impressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  viewer_id uuid,
  source text NOT NULL CHECK (source IN ('feed', 'search', 'category', 'home')),
  promoted boolean NOT NULL DEFAULT false,
  clicked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.listing_impressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert impressions" ON public.listing_impressions
  FOR INSERT WITH CHECK (true);
CREATE INDEX idx_impressions_listing ON public.listing_impressions(listing_id, created_at);
CREATE INDEX idx_impressions_promoted ON public.listing_impressions(listing_id) WHERE promoted = true;

-- Denormalized promotion fields on listings for fast sorting
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS promoted_until timestamptz,
  ADD COLUMN IF NOT EXISTS promotion_tier text;
CREATE INDEX idx_listings_promoted ON public.listings(promoted_until)
  WHERE promoted_until IS NOT NULL;
