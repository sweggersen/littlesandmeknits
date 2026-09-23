-- 0118: distinct-cities helper for the Butikker "By" filter.
--
-- listStoreCities() (rendered on every /market/stores load) selected the
-- location_city column of up to 2000 active-store rows and de-duplicated them in
-- JS. This RPC does the DISTINCT in Postgres so the payload is the (small) set
-- of cities, not one row per store — and it stays cheap as the directory grows.
--
-- SECURITY INVOKER so the caller's RLS on `stores` still applies (only publicly
-- visible active stores contribute a city).

create or replace function public.distinct_store_cities()
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  select distinct location_city
  from public.stores
  where status = 'active' and deleted_at is null and location_city is not null and location_city <> '';
$$;

grant execute on function public.distinct_store_cities() to anon, authenticated;
