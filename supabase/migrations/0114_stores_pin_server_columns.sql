-- 0114: close a stores privilege-escalation hole by replacing the blanket
-- `authenticated` UPDATE grant with a column allowlist.
--
-- Background: stores_update_admin (0108) is a USING-only manager policy with no
-- WITH CHECK, and `authenticated` (+ `anon`) held a table-wide UPDATE grant on
-- stores. So a store manager could — via a direct PostgREST call (anon key +
-- their own JWT, bypassing the service layer) — write ANY column. The
-- stores_pin_moderation_columns trigger guarded only verified/status/featured/
-- featured_rank. Confirmed exploitable: a manager could set rating_avg=5 /
-- rating_count=999 (fake ratings), inflate follower_count, rewrite orgnr +
-- legal_name/address (spoof the verified-business identity behind the blue
-- check), move lat/lng anywhere (defeat the exact-address map pin), and even
-- flip tier / subscription_status / promo_year_one_free (grant themselves paid
-- features).
--
-- Why not just pin more columns in the trigger: the denormalised stat columns
-- (rating_*, favorite_count, follower_count, active_listing_count,
-- last_listing_at) are maintained by SECURITY DEFINER triggers on
-- store_follows / store_favorites / reviews / listings. SECURITY DEFINER
-- changes the privilege but NOT auth.role(), so those maintenance UPDATEs run
-- in the original caller's (authenticated) context — a pin trigger would revert
-- their legitimate increments too. So stats can't be pinned; they must be
-- ungrantable instead.
--
-- Fix: revoke the table-wide UPDATE grant and re-grant UPDATE only on genuine
-- editorial/display columns a store manager may set. Every server-controlled
-- column (stats, geocode, public location, Brønnøysund legal identity,
-- billing/tier, ownership, moderation timestamps, slug) becomes ungrantable, so
-- PostgREST rejects a direct write. verified/status/featured/featured_rank stay
-- grantable and keep being governed by stores_pin_moderation_columns (existing
-- behaviour: the write is accepted then silently reverted). service_role and
-- the SECURITY DEFINER stat triggers own the table's privileges and are
-- unaffected, so all legitimate writes (the service does every production store
-- write) and the denormalised counters keep working.
--
-- NOTE: a NEW editable store column must be added to the grant list below, and
-- a NEW server-controlled column must be LEFT OUT of it.

begin;

-- Restore the pin trigger to exactly the four moderation columns (an earlier
-- draft over-pinned the stat columns and broke their maintenance triggers).
create or replace function public.stores_pin_moderation_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    new.verified      := old.verified;
    new.status        := old.status;
    new.featured      := old.featured;
    new.featured_rank := old.featured_rank;
  end if;
  return new;
end;
$$;

-- anon must never update a store row (no anon UPDATE policy exists anyway).
revoke update on public.stores from anon;

-- Replace the blanket grant with a column allowlist of editable fields.
revoke update on public.stores from authenticated;
grant update (
  -- Branding / display
  name, tagline, description, banner_path, logo_path, accent_color,
  -- Contact + social
  contact_email, contact_phone, website_url,
  instagram_url, etsy_url, pinterest_url, tiktok_url,
  opening_hours,
  -- Storefront builder
  theme, page_config, theme_draft, page_config_draft,
  -- Moderation columns: grantable but governed by stores_pin_moderation_columns
  -- (the write is accepted, then the trigger reverts it — preserves behaviour).
  verified, status, featured, featured_rank
) on public.stores to authenticated;

commit;
