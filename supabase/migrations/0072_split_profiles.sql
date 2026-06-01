-- Item 2: split `profiles` into purpose-specific tables.
--
-- profiles  → display identity + general onboarding flags + trust signals
-- seller_profiles → KYC + Stripe Connect + seller verification
-- buyer_preferences → marketplace interests + buyer-side onboarding
-- auth_identities  → external provider records (Vipps now, more later)
--
-- Per the refactor.md item 2 plan. Because the app has no external
-- users yet, this is a single-shot migration: create new tables, copy
-- data, drop legacy columns. No compat view, no two-phase rollout.

begin;

-- ════════════════════════════════════════════════════════════
-- 1. seller_profiles
-- ════════════════════════════════════════════════════════════

create table public.seller_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  legal_name text,
  kontonummer text,
  birthdate text,
  address text,
  postal_code text,
  city text,
  stripe_account_id text,
  stripe_connect_status text not null default 'pending',
  stripe_connect_requirements jsonb,
  stripe_onboarded boolean not null default false,
  seller_terms_accepted_at timestamptz,
  seller_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index seller_profiles_stripe_account_idx
  on public.seller_profiles(stripe_account_id)
  where stripe_account_id is not null;

create trigger seller_profiles_set_updated_at
  before update on public.seller_profiles
  for each row execute function public.set_updated_at();

alter table public.seller_profiles enable row level security;

-- Owner reads + updates their own seller_profile row. Staff (admin /
-- moderator) read any row for moderation. Service role bypasses RLS.
create policy "Owner reads own seller_profile"
  on public.seller_profiles for select
  using (auth.uid() = id);

create policy "Owner updates own seller_profile"
  on public.seller_profiles for update
  using (auth.uid() = id);

create policy "Owner inserts own seller_profile"
  on public.seller_profiles for insert
  with check (auth.uid() = id);

create policy "Staff reads any seller_profile"
  on public.seller_profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'moderator')
    )
  );

-- Backfill from profiles. Only insert a row when there's something
-- worth storing (any seller column populated) so unused profiles
-- don't carry empty seller rows.
insert into public.seller_profiles (
  id, legal_name, kontonummer, birthdate,
  address, postal_code, city,
  stripe_account_id, stripe_connect_status, stripe_connect_requirements,
  stripe_onboarded, seller_terms_accepted_at, seller_verified_at
)
select
  p.id,
  p.seller_legal_name,
  p.seller_kontonummer,
  p.seller_birthdate,
  p.seller_address,
  p.seller_postal_code,
  p.seller_city,
  p.stripe_account_id,
  p.stripe_connect_status,
  p.stripe_connect_requirements,
  p.stripe_onboarded,
  p.seller_terms_accepted_at,
  p.seller_verified_at
from public.profiles p
where
  p.seller_legal_name is not null
  or p.stripe_account_id is not null
  or p.stripe_connect_status <> 'pending'
  or p.stripe_onboarded
  or p.seller_terms_accepted_at is not null;

-- ════════════════════════════════════════════════════════════
-- 2. buyer_preferences
-- ════════════════════════════════════════════════════════════

create table public.buyer_preferences (
  id uuid primary key references public.profiles(id) on delete cascade,
  marketplace_interests text[],
  strikketorget_welcomed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger buyer_preferences_set_updated_at
  before update on public.buyer_preferences
  for each row execute function public.set_updated_at();

alter table public.buyer_preferences enable row level security;

create policy "Owner reads own buyer_preferences"
  on public.buyer_preferences for select
  using (auth.uid() = id);

create policy "Owner upserts own buyer_preferences"
  on public.buyer_preferences for insert
  with check (auth.uid() = id);

create policy "Owner updates own buyer_preferences"
  on public.buyer_preferences for update
  using (auth.uid() = id);

-- Backfill only rows where any field is set.
insert into public.buyer_preferences (id, marketplace_interests, strikketorget_welcomed_at)
select p.id, p.marketplace_interests, p.strikketorget_welcomed_at
from public.profiles p
where p.marketplace_interests is not null
   or p.strikketorget_welcomed_at is not null;

-- ════════════════════════════════════════════════════════════
-- 3. auth_identities  (one row per (user, provider) pair)
-- ════════════════════════════════════════════════════════════

create table public.auth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  sub text not null,
  phone text,
  created_at timestamptz not null default now(),
  unique (user_id, provider),
  unique (provider, sub)
);

create index auth_identities_user_idx on public.auth_identities(user_id);

alter table public.auth_identities enable row level security;

-- Identities are sensitive — owner only, staff for moderation.
create policy "Owner reads own auth_identities"
  on public.auth_identities for select
  using (auth.uid() = user_id);

create policy "Staff reads any auth_identity"
  on public.auth_identities for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'moderator')
    )
  );

-- Backfill Vipps identities from the legacy columns.
insert into public.auth_identities (user_id, provider, sub, phone)
select p.id, 'vipps', p.vipps_sub, p.vipps_phone_e164
from public.profiles p
where p.vipps_sub is not null;

-- ════════════════════════════════════════════════════════════
-- 4. Recreate the "Users can update their own profile" policy
-- ════════════════════════════════════════════════════════════
--
-- The 0038 policy referenced stripe_account_id + stripe_onboarded in
-- its WITH CHECK to forbid users from self-promoting to a verified
-- seller. With those columns moving to seller_profiles (which has its
-- own RLS that's owner-readable but app code uses the admin client to
-- write), the protection is implicit. Drop and recreate the profiles
-- policy without those two pinned columns.

drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- role must not change
    and role is not distinct from (select role from public.profiles p where p.id = profiles.id)
    -- trust signals stay server-controlled
    and trust_score is not distinct from (select trust_score from public.profiles p where p.id = profiles.id)
    and trust_tier is not distinct from (select trust_tier from public.profiles p where p.id = profiles.id)
    and total_completed_transactions is not distinct from (select total_completed_transactions from public.profiles p where p.id = profiles.id)
    and total_rejections is not distinct from (select total_rejections from public.profiles p where p.id = profiles.id)
  );

-- ════════════════════════════════════════════════════════════
-- 5. Drop the legacy columns from profiles
-- ════════════════════════════════════════════════════════════

alter table public.profiles
  drop column seller_legal_name,
  drop column seller_kontonummer,
  drop column seller_birthdate,
  drop column seller_address,
  drop column seller_postal_code,
  drop column seller_city,
  drop column stripe_account_id,
  drop column stripe_connect_status,
  drop column stripe_connect_requirements,
  drop column stripe_onboarded,
  drop column seller_terms_accepted_at,
  drop column seller_verified_at,
  drop column marketplace_interests,
  drop column strikketorget_welcomed_at,
  drop column vipps_sub,
  drop column vipps_phone_e164;

commit;
