-- 0114: close a stores RLS privilege-escalation hole.
--
-- Background: stores_update_admin (0108) is a USING-only policy
-- (has_store_min_role(id,'manager')) with NO WITH CHECK, and `authenticated`
-- holds column-level UPDATE grants on nearly every stores column. The
-- stores_pin_moderation_columns BEFORE UPDATE trigger was the only thing
-- guarding server-controlled columns — but it pinned ONLY verified/status/
-- featured/featured_rank. Everything else was writable by any store
-- manager via a direct PostgREST call (anon key + their own JWT), bypassing
-- the service layer entirely. Confirmed exploitable: a manager could set
-- rating_avg=5/rating_count=999 (fake perfect ratings), inflate
-- follower_count, rewrite orgnr + legal_name/address (spoof the verified
-- business identity behind the blue check), and move lat/lng anywhere (defeat
-- the exact-address pin that the store map treats as a location signal).
--
-- Fix: extend the trigger to also pin every server-controlled column —
-- denormalised stats, geocode, Brønnøysund legal identity, ownership/
-- moderation, slug, and the public location that must stay coherent with the
-- geocode. A non-service caller can still edit genuine branding/display fields
-- (name, tagline, description, contact_email, website_url, accent_color,
-- logo/banner, opening_hours, theme, page_config, drafts); the service
-- (service_role) is exempt and remains the only path that changes the pinned
-- columns. In production every store write already goes through the service,
-- so no legitimate flow is affected.
--
-- NOTE: any NEW server-controlled column added to `stores` later must be added
-- to the pin list below, or it reopens this exact hole.

begin;

create or replace function public.stores_pin_moderation_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    -- Moderation / verification (existing).
    new.verified              := old.verified;
    new.status                := old.status;
    new.featured              := old.featured;
    new.featured_rank         := old.featured_rank;
    -- Denormalised, trigger-maintained stats — must never be self-set.
    new.rating_avg            := old.rating_avg;
    new.rating_count          := old.rating_count;
    new.favorite_count        := old.favorite_count;
    new.follower_count        := old.follower_count;
    new.active_listing_count  := old.active_listing_count;
    new.last_listing_at       := old.last_listing_at;
    -- Server-geocoded coordinates (the store map's location signal).
    new.lat                   := old.lat;
    new.lng                   := old.lng;
    new.geocoded_at           := old.geocoded_at;
    -- Public location, kept coherent with the geocode (changed via the service,
    -- which re-geocodes).
    new.postnummer            := old.postnummer;
    new.location_city         := old.location_city;
    -- Brønnøysund legal identity behind the verified badge — read-only after
    -- lookup, never editable by a direct caller.
    new.orgnr                 := old.orgnr;
    new.legal_name            := old.legal_name;
    new.legal_address         := old.legal_address;
    new.legal_business_type   := old.legal_business_type;
    new.legal_industry_code   := old.legal_industry_code;
    new.legal_status          := old.legal_status;
    new.legal_founded_date    := old.legal_founded_date;
    -- Ownership record + moderation timestamp + URL identity.
    new.created_by            := old.created_by;
    new.approved_at           := old.approved_at;
    new.slug                  := old.slug;
  end if;
  return new;
end;
$$;

-- Trigger definition unchanged (BEFORE UPDATE, per row); recreate defensively so
-- this migration is self-contained.
drop trigger if exists stores_pin_moderation_columns on public.stores;
create trigger stores_pin_moderation_columns
  before update on public.stores
  for each row
  execute function public.stores_pin_moderation_columns();

comment on function public.stores_pin_moderation_columns() is
  'Pins every server-controlled stores column (moderation, denormalised stats, geocode, public location, Brønnøysund legal identity, ownership, slug) to its stored value for any non-service-role UPDATE, so a store manager cannot self-verify, fake stats/ratings, spoof legal identity, or move their map pin via direct PostgREST. New server-controlled columns must be added here.';

commit;
