-- Optional "Strikket av" credit field on listings. Separate from the
-- seller account so a store can credit a contributor by name, or a
-- private seller can credit their mormor / partner / etc.
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS knitted_by text;

COMMENT ON COLUMN public.listings.knitted_by IS
  'Free-text credit of who actually knit the item. Optional — defaults to NULL.';
