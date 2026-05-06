-- Knitter profiles: seller-side opt-in extending public.profiles.
-- A row exists only when a user toggles "Bli strikker" and starts the
-- Stripe Connect onboarding. Closed availability is the default (= not
-- publicly visible) so a partial onboarding doesn't leak.

create type public.knitter_availability as enum ('open', 'waitlist', 'closed');

create table public.knitter_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,

  slug text unique not null,
  bio text,
  specialties text[] not null default '{}',
  availability public.knitter_availability not null default 'closed',
  turnaround_weeks_min int,
  turnaround_weeks_max int,
  hourly_rate_nok int,
  accepts_commissions boolean not null default false,
  accepts_yarn_provided_by_buyer boolean not null default true,

  -- Stripe Connect Express. Mirrored from Stripe via webhook.
  stripe_account_id text unique,
  stripe_charges_enabled boolean not null default false,
  stripe_payouts_enabled boolean not null default false,

  -- Self-declared tax status. Used in receipts; we don't verify.
  mva_registered boolean not null default false,
  org_number text,
  display_country text not null default 'NO',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index knitter_profiles_visible_idx
  on public.knitter_profiles(availability)
  where availability <> 'closed';

create trigger knitter_profiles_set_updated_at
  before update on public.knitter_profiles
  for each row execute function public.set_updated_at();

alter table public.knitter_profiles enable row level security;

create policy "Public reads non-closed knitter profiles"
  on public.knitter_profiles for select
  using (availability <> 'closed');

create policy "Owner reads own knitter profile"
  on public.knitter_profiles for select using (auth.uid() = user_id);

create policy "Owner inserts own knitter profile"
  on public.knitter_profiles for insert with check (auth.uid() = user_id);

create policy "Owner updates own knitter profile"
  on public.knitter_profiles for update using (auth.uid() = user_id);
