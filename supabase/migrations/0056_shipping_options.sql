-- Seller-chosen shipping option per listing, and clarification of who
-- pays for what.
--
-- Trygg betaling (TB) is now FREE for the seller — buyer pays a
-- protection fee at checkout. The fee scales by listing price:
--   ≤200 kr  → 9 kr
--   201–500  → 19 kr
--   501+     → 29 kr
--
-- Postage: seller picks a package size (or 'free' = seller absorbs).
-- The matching base postage price is stored on the listing so it's
-- locked when the buyer pays — even if our default tiers change later.

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS shipping_option text
    CHECK (shipping_option IN ('free', 'small_letter', 'small_parcel', 'parcel')),
  ADD COLUMN IF NOT EXISTS shipping_price_nok integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.listings.shipping_option IS
  'free=seller absorbs, small_letter=Brev ≤350g, small_parcel=Norgespakke liten ≤5kg, parcel=Norgespakke stor ≤10kg.';

COMMENT ON COLUMN public.listings.shipping_price_nok IS
  'Locked postage price at listing time. Zero when shipping_option=free.';

-- TB fee charged to the buyer at the moment of purchase. Stored on the
-- listing once paid (mirrored from buyer_tb_fee_nok on the order).
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS buyer_tb_fee_nok integer;

COMMENT ON COLUMN public.listings.buyer_tb_fee_nok IS
  'Trygg betaling fee paid by the buyer at checkout. Platform revenue.';

-- Listing rows older than this migration default to shipping_option='free'
-- so they don't break the old purchase flow.
UPDATE public.listings SET shipping_option = 'free'
WHERE shipping_option IS NULL;
