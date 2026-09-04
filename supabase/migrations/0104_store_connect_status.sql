-- Store-level Stripe Connect onboarding (M5). A store is its own seller of
-- record, so it gets its own Express Connect account (NOT the member's). The
-- escrow payout path already routes store-owned listings to stores.stripe_account_id;
-- this adds the status/requirements columns the webhook + admin UI need to
-- drive onboarding, mirroring seller_profiles.stripe_connect_status.
alter table public.stores
  add column if not exists stripe_connect_status text,
  add column if not exists stripe_connect_requirements jsonb;

comment on column public.stores.stripe_connect_status is
  'Coarse Connect status derived from the Stripe Account object: pending|restricted|verified|rejected. NULL = no account yet.';
comment on column public.stores.stripe_connect_requirements is
  'Latest Stripe requirements object (currently_due/past_due/disabled_reason) so store owners can see what Stripe still needs.';
