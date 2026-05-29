-- Stripe Connect Custom seller onboarding (Tise-style).
-- Sellers enter their bank account, name, birthdate, and address in our
-- own UI — they never see Stripe branding. We create a Connect Custom
-- account via the API and Stripe runs KYC in the background.

ALTER TABLE public.profiles
  -- Seller-provided fields (collected in our 'Bli selger' form)
  ADD COLUMN IF NOT EXISTS seller_legal_name text,
  ADD COLUMN IF NOT EXISTS seller_birthdate date,
  ADD COLUMN IF NOT EXISTS seller_kontonummer text,        -- 11 digits, MOD-11 validated
  ADD COLUMN IF NOT EXISTS seller_address text,
  ADD COLUMN IF NOT EXISTS seller_postal_code text,
  ADD COLUMN IF NOT EXISTS seller_city text,

  -- Stripe Connect Custom account state. stripe_account_id already
  -- exists from the earlier Standard-account integration; we'll reuse
  -- it for Custom accounts going forward.
  ADD COLUMN IF NOT EXISTS stripe_connect_status text NOT NULL DEFAULT 'not_started'
    CHECK (stripe_connect_status IN ('not_started', 'pending', 'restricted', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS stripe_connect_requirements jsonb,
  ADD COLUMN IF NOT EXISTS seller_terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS seller_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_connect_status
  ON public.profiles(stripe_connect_status)
  WHERE stripe_connect_status != 'not_started';

-- Hard cap on listing price. We're using Stripe Connect Custom payouts
-- which work for any amount, but we want to limit blast radius on
-- disputes / fraud while we're still small. Can be relaxed later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'listings_price_cap' AND conrelid = 'public.listings'::regclass
  ) THEN
    ALTER TABLE public.listings
      ADD CONSTRAINT listings_price_cap CHECK (price_nok <= 5000);
  END IF;
END$$;
