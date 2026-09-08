-- 0109: Butikker store directory (Phase 1).
--
-- Turns the flat store list into a filterable, sortable, paginated directory.
-- Adds:
--   1a. Denormalised stats on `stores` (rating, active-listing count, last
--       listing time), trigger-maintained so the grid sorts/filters in one
--       indexed query instead of aggregating per request.
--   1b. Admin-only `featured` / `featured_rank` for the "Anbefalte" strip,
--       pinned by the 0108 moderation trigger so they can't be self-set.
--   1c. Coarse public geocoordinates (from the POSTNUMMER only) for distance
--       sorting, plus a REQUIRED but PRIVATE exact address in a separate
--       RLS-gated table (fraud/verification signal, never public).
--   1d. `store_favorites` (+ last_seen_at for the "new listings" dot).

begin;

-- ════════════════════════════════════════════════════════════════════
-- 1a. Denormalised stats + triggers
-- ════════════════════════════════════════════════════════════════════

alter table public.stores
  add column if not exists rating_avg numeric(3,2) not null default 0,
  add column if not exists rating_count int not null default 0,
  add column if not exists active_listing_count int not null default 0,
  add column if not exists last_listing_at timestamptz;

comment on column public.stores.rating_avg is 'Denormalised avg of seller_reviews.rating for this store. Trigger-maintained.';
comment on column public.stores.active_listing_count is 'Denormalised count of active listings owned by this store. Trigger-maintained.';
comment on column public.stores.last_listing_at is 'max(published_at) over this store''s active listings. Drives the "Mest aktive" sort + new-listing dot.';

-- Recompute helpers. SECURITY DEFINER so a reviewer/seller whose write fires the
-- trigger can update the (otherwise RLS-protected) stores row. search_path pinned.
create or replace function public.store_recompute_reviews(sid uuid)
returns void language sql security definer set search_path = public as $$
  update public.stores s set
    rating_avg = coalesce((select round(avg(r.rating)::numeric, 2)
                           from public.seller_reviews r where r.store_id = sid), 0),
    rating_count = (select count(*) from public.seller_reviews r where r.store_id = sid)
  where s.id = sid;
$$;

create or replace function public.store_recompute_listings(sid uuid)
returns void language sql security definer set search_path = public as $$
  update public.stores s set
    active_listing_count = (select count(*) from public.listings l
                            where l.store_id = sid and l.status = 'active'),
    last_listing_at = (select max(l.published_at) from public.listings l
                       where l.store_id = sid and l.status = 'active')
  where s.id = sid;
$$;

-- Trigger fns: recompute the affected store(s). On UPDATE where store_id moved,
-- both old and new stores are recomputed.
create or replace function public.trg_store_reviews_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE') then
    if old.store_id is not null then perform public.store_recompute_reviews(old.store_id); end if;
    return old;
  end if;
  if (tg_op = 'UPDATE' and old.store_id is distinct from new.store_id and old.store_id is not null) then
    perform public.store_recompute_reviews(old.store_id);
  end if;
  if new.store_id is not null then perform public.store_recompute_reviews(new.store_id); end if;
  return new;
end;
$$;

create or replace function public.trg_store_listings_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE') then
    if old.store_id is not null then perform public.store_recompute_listings(old.store_id); end if;
    return old;
  end if;
  if (tg_op = 'UPDATE') then
    -- Only recompute when a stat-relevant column changed (listings churn a lot:
    -- favorite_count, view bumps, promotion windows must NOT trigger a recompute).
    if (old.store_id is not distinct from new.store_id
        and old.status is not distinct from new.status
        and old.published_at is not distinct from new.published_at) then
      return new;
    end if;
    if (old.store_id is distinct from new.store_id and old.store_id is not null) then
      perform public.store_recompute_listings(old.store_id);
    end if;
  end if;
  if new.store_id is not null then perform public.store_recompute_listings(new.store_id); end if;
  return new;
end;
$$;

drop trigger if exists trg_seller_reviews_store_stats on public.seller_reviews;
create trigger trg_seller_reviews_store_stats
  after insert or update or delete on public.seller_reviews
  for each row execute function public.trg_store_reviews_stats();

drop trigger if exists trg_listings_store_stats on public.listings;
create trigger trg_listings_store_stats
  after insert or update or delete on public.listings
  for each row execute function public.trg_store_listings_stats();

-- Backfill every existing store.
update public.stores s set
  rating_avg = coalesce((select round(avg(r.rating)::numeric, 2)
                         from public.seller_reviews r where r.store_id = s.id), 0),
  rating_count = (select count(*) from public.seller_reviews r where r.store_id = s.id),
  active_listing_count = (select count(*) from public.listings l
                          where l.store_id = s.id and l.status = 'active'),
  last_listing_at = (select max(l.published_at) from public.listings l
                     where l.store_id = s.id and l.status = 'active');

create index if not exists idx_stores_rating on public.stores(rating_avg desc) where deleted_at is null;
create index if not exists idx_stores_last_listing on public.stores(last_listing_at desc) where deleted_at is null;

-- ════════════════════════════════════════════════════════════════════
-- 1b. Featured / partner flag (admin-only, server-pinned)
-- ════════════════════════════════════════════════════════════════════

alter table public.stores
  add column if not exists featured boolean not null default false,
  add column if not exists featured_rank int not null default 0;

comment on column public.stores.featured is 'Server-controlled. Admin-set partner flag for the "Anbefalte" strip. Pinned by stores_pin_moderation_columns — never settable by a direct PostgREST caller.';

create index if not exists idx_stores_featured on public.stores(featured_rank desc) where featured;

-- Extend the 0108 pin trigger so `featured`/`featured_rank` join verified/status
-- as columns a non-service caller cannot change. A "partner" badge is a trust
-- signal; only the staff service (service-role) may set it.
create or replace function public.stores_pin_moderation_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then
    new.verified := old.verified;
    new.status := old.status;
    new.featured := old.featured;
    new.featured_rank := old.featured_rank;
  end if;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 1c. Location: coarse public coords + REQUIRED private address
-- ════════════════════════════════════════════════════════════════════

-- Public, coarse. Coordinates are resolved from the POSTNUMMER only (see
-- src/lib/geocode.ts), so the map marker + distance sort can't reveal a home.
alter table public.stores
  add column if not exists postnummer text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists geocoded_at timestamptz;

comment on column public.stores.postnummer is 'Public 4-digit postal code. The geocode key; shown with the city.';
comment on column public.stores.lat is 'Postnummer-area centroid latitude (coarse) from Kartverket. NOT the street point.';

-- Bounding-box prefilter for the "Nærmest" sort.
create index if not exists idx_stores_coords on public.stores(lat, lng)
  where deleted_at is null and lat is not null;

-- Private exact address lives in its OWN table, not a stores column: the
-- stores_select_public_active policy exposes every column of an active store to
-- anon, and several call sites `select('*')` from stores. A separate RLS-gated
-- table keeps the address readable ONLY by the store's members + staff, and
-- never leaks through a public select or the directory query.
create table if not exists public.store_private_details (
  store_id        uuid primary key references public.stores(id) on delete cascade,
  precise_address text,
  updated_at      timestamptz not null default now()
);

comment on table public.store_private_details is 'Private per-store data (exact address) used ONLY for fraud/verification + coarse geocoding. Never public. Required at the app layer; nullable here so existing rows do not break.';

alter table public.store_private_details enable row level security;

-- Read: the store's own members (any role) OR staff. Never anon, never other users.
drop policy if exists spd_select_members on public.store_private_details;
create policy spd_select_members on public.store_private_details for select
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = store_private_details.store_id
        and sm.user_id = auth.uid()
    )
    or public.is_admin_or_moderator((select auth.uid()))
  );

-- Writes go through the store service (service-role client), which bypasses RLS.
-- No INSERT/UPDATE/DELETE policy for anon/authenticated => direct callers cannot write.
grant select on public.store_private_details to authenticated;
grant all on public.store_private_details to service_role;

-- Buyer-side coords for the "Nærmest" sort, cached on the (private) seller
-- profile, geocoded from the seller's postal_code. Buyers who never became
-- sellers have no coords => the "Nærmest" sort + distance chips hide for them.
alter table public.seller_profiles
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists geocoded_at timestamptz;

-- ════════════════════════════════════════════════════════════════════
-- 1d. store_favorites
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.store_favorites (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  store_id     uuid not null references public.stores(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),  -- bumped when the user opens the store
  primary key (user_id, store_id)
);

comment on table public.store_favorites is 'A user''s favourited stores. last_seen_at drives the "new listings since your last visit" dot.';

create index if not exists idx_store_favorites_store on public.store_favorites(store_id);

alter table public.store_favorites enable row level security;

-- Users manage ONLY their own rows (positive + negative RLS test in the
-- store-directory integration suite).
drop policy if exists sf_rw on public.store_favorites;
create policy sf_rw on public.store_favorites for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.store_favorites to authenticated;
grant all on public.store_favorites to service_role;

-- Optional denormalised favourite_count for display.
alter table public.stores
  add column if not exists favorite_count int not null default 0;

create or replace function public.trg_store_favorites_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    update public.stores set favorite_count = favorite_count + 1 where id = new.store_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.stores set favorite_count = greatest(0, favorite_count - 1) where id = old.store_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_store_favorites_count on public.store_favorites;
create trigger trg_store_favorites_count
  after insert or delete on public.store_favorites
  for each row execute function public.trg_store_favorites_count();

commit;
