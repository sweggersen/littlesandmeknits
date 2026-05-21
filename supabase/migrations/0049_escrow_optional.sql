-- Make publishing free; gate "trygg betaling" (escrow + dispute coverage)
-- behind an optional 29 NOK upgrade fee per listing.

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS escrow_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escrow_fee_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS escrow_fee_session_id text;

COMMENT ON COLUMN public.listings.escrow_enabled IS
  'True when the seller has paid the escrow-upgrade fee (29 NOK) or '
  'the listing is store-owned (escrow included with store subscription). '
  'When false, buyers see a "Kontakt selger" button instead of "Kjøp nå" — '
  'no platform payment, no dispute coverage.';

-- Back-fill: any listing that paid the old non-optional publishing fee
-- already paid for what we now call trygg betaling.
UPDATE public.listings
  SET escrow_enabled = true,
      escrow_fee_paid_at = COALESCE(published_at, now()),
      escrow_fee_session_id = listing_fee_session_id
  WHERE listing_fee_session_id IS NOT NULL
    AND escrow_enabled = false;

-- Store-owned listings get escrow free (covered by store subscription).
UPDATE public.listings
  SET escrow_enabled = true
  WHERE store_id IS NOT NULL
    AND escrow_enabled = false;

CREATE INDEX IF NOT EXISTS idx_listings_escrow_enabled
  ON public.listings(escrow_enabled)
  WHERE escrow_enabled = true;
