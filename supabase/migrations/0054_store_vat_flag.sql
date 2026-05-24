-- VAT-registration flag for stores. Stores that are registered in
-- Merverdiavgiftsregisteret must show "MVA inkl. 25 %" on receipts and
-- in their bookkeeping export. Default false (most small operators are
-- below the 50 000 kr / 12 mnd terskel).
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS vat_registered boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stores.vat_registered IS
  'True when the store is registered in Merverdiavgiftsregisteret. Drives "MVA inkl. 25 %" line on receipts.';
