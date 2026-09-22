-- 0117: record how a store's coords were resolved, so the store-geocode
-- backfill can find and upgrade the ones that aren't exact yet.
--
-- Stores geocode their EXACT street address first (a business location is
-- public), falling back to the postnummer centroid. But stores created before
-- that pipeline (and any whose exact geocode failed at create time) carry coarse
-- coords with no way to tell them apart from exact ones. This column is that
-- marker: 'exact' = full street address, 'coarse' = postnummer-centroid
-- fallback, NULL = not yet processed by the exact-address geocoder. The
-- self-healing backfill (backfillStoreGeocode) targets NULL rows, upgrades them,
-- then no-ops — mirroring the seller backfill's `lat is null` termination.
--
-- Server-controlled: set only via the service (service_role). It is deliberately
-- NOT added to the 0114 authenticated UPDATE allowlist, so a direct PostgREST
-- caller cannot set it.

alter table public.stores
  add column if not exists geocode_precision text
  check (geocode_precision is null or geocode_precision in ('coarse', 'exact'));

comment on column public.stores.geocode_precision is
  'How lat/lng was resolved: exact = full street address, coarse = postnummer centroid fallback, NULL = not yet processed by the exact-address geocoder (backfill target). Server-controlled; not in the authenticated UPDATE allowlist (0114).';
