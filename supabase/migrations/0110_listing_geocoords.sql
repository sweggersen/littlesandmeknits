-- 0110: coarse public coordinates on listings, for the "Nærmest" sort on the
-- brukt/nytt grids.
--
-- A listing's location is its seller's. seller_profiles is private (owner-read
-- RLS), so a buyer browsing can't read another seller's coords — the coarse
-- point must live on the PUBLIC listings row instead. It is the seller's
-- postnummer-area centroid (from Kartverket), never a precise location, so
-- publishing it is the same privacy stance as stores.
--
-- Populated app-side: becomeSeller geocodes the seller + propagates to their
-- listings; createListing copies the seller's coords. This migration also
-- back-copies from any already-geocoded sellers (a no-op until they are).

begin;

alter table public.listings
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists geocoded_at timestamptz;

comment on column public.listings.lat is 'Coarse public latitude = the seller''s postnummer-area centroid (Kartverket). NOT precise. Drives the "Nærmest" sort + distance chips.';

-- Bounding-box prefilter for the distance sort.
create index if not exists idx_listings_coords on public.listings(lat, lng)
  where status = 'active' and lat is not null;

-- Back-copy from already-geocoded sellers (no-op until the seller backfill runs).
update public.listings l
   set lat = sp.lat, lng = sp.lng, geocoded_at = now()
  from public.seller_profiles sp
 where sp.id = l.seller_id
   and sp.lat is not null
   and l.lat is null;

commit;
