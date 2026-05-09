-- Commission marketplace: "Strikk for meg" (Knit for me)
-- Buyers post requests, knitters bid with price + timeframe.
-- Phase 1: no payment on-platform. Phase 2 adds Stripe Connect escrow.

------------------------------------------------------------
-- Enums
------------------------------------------------------------
create type public.commission_request_status as enum ('open', 'awarded', 'cancelled', 'expired');
create type public.commission_offer_status as enum ('pending', 'accepted', 'declined', 'withdrawn');

------------------------------------------------------------
-- commission_requests
------------------------------------------------------------
create table public.commission_requests (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,

  title text not null,
  description text,
  category public.listing_category not null,

  size_label text not null,
  size_age_months_min int,
  size_age_months_max int,

  colorway text,
  pattern_slug text,
  pattern_external_title text,
  yarn_preference text,
  yarn_provided_by_buyer boolean not null default false,

  budget_nok_min int not null check (budget_nok_min >= 0),
  budget_nok_max int not null check (budget_nok_max >= budget_nok_min),

  needed_by date,
  status public.commission_request_status not null default 'open',
  awarded_offer_id uuid,
  offer_count int not null default 0,

  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.commission_requests enable row level security;

create index idx_commission_requests_open
  on public.commission_requests (category, created_at desc)
  where status = 'open';

create index idx_commission_requests_buyer
  on public.commission_requests (buyer_id, status);

------------------------------------------------------------
-- commission_offers
------------------------------------------------------------
create table public.commission_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.commission_requests(id) on delete cascade,
  knitter_id uuid not null references public.profiles(id) on delete cascade,

  price_nok int not null check (price_nok >= 0),
  turnaround_weeks int not null check (turnaround_weeks > 0),
  message text not null,

  project_id uuid references public.projects(id) on delete set null,
  status public.commission_offer_status not null default 'pending',
  created_at timestamptz not null default now(),

  constraint one_offer_per_knitter unique (request_id, knitter_id)
);

alter table public.commission_offers enable row level security;

create index idx_commission_offers_request
  on public.commission_offers (request_id, status);

create index idx_commission_offers_knitter
  on public.commission_offers (knitter_id, status);

-- FK from requests to offers (deferred because offers table didn't exist yet)
alter table public.commission_requests
  add constraint commission_requests_awarded_offer_fkey
  foreign key (awarded_offer_id) references public.commission_offers(id)
  on delete set null;

------------------------------------------------------------
-- Project linking: commission_offer_id on projects
------------------------------------------------------------
alter table public.projects
  add column if not exists commission_offer_id uuid
  references public.commission_offers(id) on delete set null;

------------------------------------------------------------
-- RLS: commission_requests
------------------------------------------------------------

-- Anyone can browse open requests
create policy "Anyone reads open requests"
  on public.commission_requests for select
  using (status = 'open');

-- Buyer sees own requests in any status
create policy "Buyer reads own requests"
  on public.commission_requests for select
  using (auth.uid() = buyer_id);

-- Knitters can see awarded requests they have offers on
create policy "Knitter reads requests with own offers"
  on public.commission_requests for select
  using (
    exists (
      select 1 from public.commission_offers
      where commission_offers.request_id = commission_requests.id
        and commission_offers.knitter_id = auth.uid()
    )
  );

-- Buyer creates requests
create policy "Buyer inserts own requests"
  on public.commission_requests for insert
  with check (auth.uid() = buyer_id);

-- Buyer updates own requests (cancel, award)
create policy "Buyer updates own requests"
  on public.commission_requests for update
  using (auth.uid() = buyer_id);

------------------------------------------------------------
-- RLS: commission_offers
------------------------------------------------------------

-- Anyone reads offers on open/awarded requests (prices are public)
create policy "Anyone reads offers on visible requests"
  on public.commission_offers for select
  using (
    exists (
      select 1 from public.commission_requests r
      where r.id = request_id
        and r.status in ('open', 'awarded')
    )
  );

-- Knitter reads own offers regardless of request status
create policy "Knitter reads own offers"
  on public.commission_offers for select
  using (auth.uid() = knitter_id);

-- Knitter inserts offers (cannot bid on own request)
create policy "Knitter inserts own offers"
  on public.commission_offers for insert
  with check (
    auth.uid() = knitter_id
    and auth.uid() != (select buyer_id from public.commission_requests where id = request_id)
  );

-- Knitter updates own offers (withdraw, link project)
create policy "Knitter updates own offers"
  on public.commission_offers for update
  using (auth.uid() = knitter_id);

-- Buyer updates offers on own requests (accept/decline)
create policy "Buyer updates offers on own requests"
  on public.commission_offers for update
  using (
    exists (
      select 1 from public.commission_requests r
      where r.id = request_id
        and r.buyer_id = auth.uid()
    )
  );

------------------------------------------------------------
-- RLS: buyer views linked commission projects
------------------------------------------------------------

create policy "Buyer views linked commission project"
  on public.projects for select
  using (
    commission_offer_id is not null
    and exists (
      select 1 from public.commission_offers o
      join public.commission_requests r on r.id = o.request_id
      where o.id = projects.commission_offer_id
        and r.buyer_id = auth.uid()
        and o.status = 'accepted'
    )
  );

create policy "Buyer reads logs of linked commission project"
  on public.project_logs for select
  using (
    exists (
      select 1 from public.projects p
      join public.commission_offers o on o.id = p.commission_offer_id
      join public.commission_requests r on r.id = o.request_id
      where p.id = project_logs.project_id
        and r.buyer_id = auth.uid()
        and o.status = 'accepted'
    )
  );

------------------------------------------------------------
-- Trigger: maintain offer_count on commission_requests
------------------------------------------------------------
create or replace function public.update_offer_count()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    update commission_requests
      set offer_count = offer_count + 1
      where id = NEW.request_id;
    return NEW;
  elsif TG_OP = 'UPDATE' then
    -- Decrement when offer leaves 'pending' state
    if OLD.status = 'pending' and NEW.status != 'pending' then
      update commission_requests
        set offer_count = greatest(0, offer_count - 1)
        where id = NEW.request_id;
    end if;
    return NEW;
  end if;
  return null;
end;
$$;

create trigger on_commission_offer_change
  after insert or update on public.commission_offers
  for each row execute function public.update_offer_count();
