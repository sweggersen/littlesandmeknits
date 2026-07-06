-- Item location = the seller's location (we don't collect a per-item location).
-- Backfill profiles.location from the seller's registered address city so every
-- already-onboarded seller has a location to display on their listings. Only
-- fills rows where the user hasn't chosen a public location themselves; the
-- become-seller service keeps new sellers in sync going forward. Data-only,
-- idempotent — no schema or RLS change.
UPDATE public.profiles p
SET location = btrim(sp.city)
FROM public.seller_profiles sp
WHERE sp.id = p.id
  AND sp.city IS NOT NULL
  AND btrim(sp.city) <> ''
  AND (p.location IS NULL OR btrim(p.location) = '');
