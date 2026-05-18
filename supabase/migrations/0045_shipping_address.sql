ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS buyer_name text,
  ADD COLUMN IF NOT EXISTS buyer_address text,
  ADD COLUMN IF NOT EXISTS buyer_postal_code text,
  ADD COLUMN IF NOT EXISTS buyer_city text;
