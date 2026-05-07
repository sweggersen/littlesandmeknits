-- DRAFT — DO NOT APPLY TO PROD AS-IS
--
-- This is a sketch of the marketplace schema described in
-- docs/marketplace/01-data-model.md. It is intentionally in
-- supabase/migrations-draft/ (not /migrations/) so it does not get
-- picked up by `supabase db push`.
--
-- When promoting to real migrations, split this single file into the
-- 0010..0016 sequence listed in the data-model doc, one concern per file.
--
-- Conventions matched from existing migrations (0001..0009):
--   - `set_updated_at` trigger function already exists from 0002.
--   - `profiles` already has 1:1 link to auth.users.
--   - RLS on, tight policies; service-role used for state transitions.

------------------------------------------------------------
-- Sellers: knitter_profiles (1:1 with profiles)
------------------------------------------------------------
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

  -- Stripe Connect Express
  stripe_account_id text unique,
  stripe_charges_enabled boolean not null default false,
  stripe_payouts_enabled boolean not null default false,

  mva_registered boolean not null default false,
  org_number text,
  display_country text not null default 'NO',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index knitter_profiles_availability_idx
  on public.knitter_profiles(availability)
  where availability <> 'closed';

create trigger knitter_profiles_set_updated_at
  before update on public.knitter_profiles
  for each row execute function public.set_updated_at();

alter table public.knitter_profiles enable row level security;

-- Public can see open / waitlist sellers
create policy "Public can read non-closed knitter profiles"
  on public.knitter_profiles for select
  using (availability <> 'closed');
create policy "Owner reads own knitter profile in any state"
  on public.knitter_profiles for select using (auth.uid() = user_id);
create policy "Owner inserts own knitter profile"
  on public.knitter_profiles for insert with check (auth.uid() = user_id);
create policy "Owner updates own knitter profile"
  on public.knitter_profiles for update using (auth.uid() = user_id);

------------------------------------------------------------
-- listings (pre_loved + ready_made)
------------------------------------------------------------
create type public.listing_kind as enum ('pre_loved', 'ready_made');
create type public.listing_status as enum ('draft', 'active', 'reserved', 'sold', 'removed');
create type public.listing_condition as enum ('som_ny', 'lite_brukt', 'brukt', 'slitt');
create type public.listing_category as enum (
  'genser', 'cardigan', 'lue', 'votter', 'sokker',
  'teppe', 'kjole', 'bukser', 'annet'
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,

  kind public.listing_kind not null,
  title text not null,
  description text,

  price_nok int not null check (price_nok >= 0),
  currency text not null default 'NOK',

  size_label text not null,
  size_age_months_min int,
  size_age_months_max int,
  category public.listing_category not null,
  condition public.listing_condition,
  -- condition required iff pre_loved
  constraint listings_condition_for_pre_loved
    check ((kind = 'pre_loved' and condition is not null)
           or (kind = 'ready_made' and condition is null)),

  pattern_slug text,
  pattern_external_title text,
  yarn_ids uuid[] not null default '{}',
  colorway text,

  photos text[] not null default '{}',
  hero_photo_path text,

  shipping_options jsonb not null default '[]'::jsonb,

  status public.listing_status not null default 'draft',
  published_at timestamptz,
  sold_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index listings_active_idx
  on public.listings(kind, category, published_at desc)
  where status = 'active';
create index listings_seller_idx on public.listings(seller_id, status);
create index listings_pattern_slug_idx on public.listings(pattern_slug)
  where pattern_slug is not null;
create index listings_age_range_idx
  on public.listings(size_age_months_min, size_age_months_max)
  where status = 'active';

create trigger listings_set_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

alter table public.listings enable row level security;

create policy "Public can read active listings"
  on public.listings for select using (status = 'active');
create policy "Seller reads own listings any status"
  on public.listings for select using (auth.uid() = seller_id);
create policy "Seller inserts own listings"
  on public.listings for insert with check (auth.uid() = seller_id);
create policy "Seller updates own listings"
  on public.listings for update using (auth.uid() = seller_id);
create policy "Seller deletes own draft listings"
  on public.listings for delete using (auth.uid() = seller_id and status = 'draft');

------------------------------------------------------------
-- commission_requests + commission_offers
------------------------------------------------------------
create type public.commission_request_status as enum ('open', 'awarded', 'cancelled', 'expired');
create type public.commission_offer_status as enum ('pending', 'accepted', 'declined', 'withdrawn');

create table public.commission_requests (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,

  title text not null,
  description text,
  pattern_slug text,
  pattern_external_title text,

  size_label text,
  size_age_months_min int,
  size_age_months_max int,
  colorway text,
  yarn_ids uuid[] not null default '{}',
  yarn_provided_by_buyer boolean not null default false,

  budget_nok_min int,
  budget_nok_max int,
  needed_by date,

  status public.commission_request_status not null default 'open',
  awarded_offer_id uuid, -- FK added below after offers table exists

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index commission_requests_open_idx
  on public.commission_requests(created_at desc)
  where status = 'open';

create trigger commission_requests_set_updated_at
  before update on public.commission_requests
  for each row execute function public.set_updated_at();

alter table public.commission_requests enable row level security;
create policy "Auth users can read open commission requests"
  on public.commission_requests for select to authenticated
  using (status = 'open' or auth.uid() = buyer_id);
create policy "Buyer inserts own request"
  on public.commission_requests for insert with check (auth.uid() = buyer_id);
create policy "Buyer updates own request"
  on public.commission_requests for update using (auth.uid() = buyer_id);

create table public.commission_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.commission_requests(id) on delete cascade,
  knitter_id uuid not null references public.profiles(id) on delete cascade,

  price_nok int not null check (price_nok >= 0),
  turnaround_weeks int not null check (turnaround_weeks > 0),
  message text,

  status public.commission_offer_status not null default 'pending',

  created_at timestamptz not null default now(),
  unique (request_id, knitter_id)
);

create index commission_offers_request_idx on public.commission_offers(request_id);
create index commission_offers_knitter_idx on public.commission_offers(knitter_id, status);

alter table public.commission_offers enable row level security;
create policy "Buyer + offering knitter can read offer"
  on public.commission_offers for select using (
    auth.uid() = knitter_id
    or auth.uid() in (select buyer_id from public.commission_requests where id = request_id)
  );
create policy "Knitter inserts own offer"
  on public.commission_offers for insert with check (auth.uid() = knitter_id);
create policy "Knitter withdraws own offer"
  on public.commission_offers for update using (auth.uid() = knitter_id);

alter table public.commission_requests
  add constraint commission_requests_awarded_offer_fk
  foreign key (awarded_offer_id) references public.commission_offers(id);

------------------------------------------------------------
-- marketplace_orders (the central transaction)
------------------------------------------------------------
create type public.order_kind as enum ('pre_loved', 'ready_made', 'commission');
create type public.order_status as enum (
  'draft',
  'pending_payment',
  'paid',
  'in_progress',
  'shipped',
  'delivered',
  'released',
  'disputed',
  'refunded',
  'cancelled'
);

create table public.marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  kind public.order_kind not null,

  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,

  listing_id uuid references public.listings(id),
  commission_offer_id uuid references public.commission_offers(id),
  -- exactly one of (listing_id, commission_offer_id) must be set
  constraint orders_one_source check (
    (listing_id is not null) <> (commission_offer_id is not null)
  ),

  gross_nok int not null check (gross_nok >= 0),
  platform_fee_nok int not null default 0 check (platform_fee_nok >= 0),
  net_to_seller_nok int not null default 0 check (net_to_seller_nok >= 0),
  currency text not null default 'NOK',

  stripe_payment_intent_id text unique,
  stripe_application_fee_id text,

  shipping_address jsonb,
  shipping_carrier text,
  shipping_tracking text,

  status public.order_status not null default 'draft',
  disputed_at timestamptz,
  dispute_reason text,

  created_at timestamptz not null default now(),
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  cancelled_at timestamptz
);

create index orders_buyer_idx on public.marketplace_orders(buyer_id, created_at desc);
create index orders_seller_idx on public.marketplace_orders(seller_id, created_at desc);
create index orders_status_idx on public.marketplace_orders(status, created_at desc);

alter table public.marketplace_orders enable row level security;
create policy "Buyer reads own orders"
  on public.marketplace_orders for select using (auth.uid() = buyer_id);
create policy "Seller reads own orders"
  on public.marketplace_orders for select using (auth.uid() = seller_id);
-- Mutations: service-role only via API/webhooks.

------------------------------------------------------------
-- order_messages, order_events
------------------------------------------------------------
create table public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index order_messages_order_idx on public.order_messages(order_id, created_at);

alter table public.order_messages enable row level security;
create policy "Order participants read messages"
  on public.order_messages for select using (
    auth.uid() in (
      select buyer_id from public.marketplace_orders where id = order_id
      union all
      select seller_id from public.marketplace_orders where id = order_id
    )
  );
create policy "Order participants insert messages"
  on public.order_messages for insert with check (
    auth.uid() = sender_id
    and auth.uid() in (
      select buyer_id from public.marketplace_orders where id = order_id
      union all
      select seller_id from public.marketplace_orders where id = order_id
    )
  );

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  kind text not null, -- e.g. 'paid', 'shipped', 'dispute_opened'
  payload jsonb,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events(order_id, created_at);

alter table public.order_events enable row level security;
create policy "Order participants read events"
  on public.order_events for select using (
    auth.uid() in (
      select buyer_id from public.marketplace_orders where id = order_id
      union all
      select seller_id from public.marketplace_orders where id = order_id
    )
  );
-- Inserts via service-role only.

------------------------------------------------------------
-- reviews
------------------------------------------------------------
create type public.review_direction as enum ('buyer_to_seller', 'seller_to_buyer');

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.profiles(id) on delete cascade,
  direction public.review_direction not null,
  rating smallint not null check (rating between 1 and 5),
  body text,
  photos text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (order_id, direction)
);
create index reviews_subject_idx on public.reviews(subject_id, created_at desc);

alter table public.reviews enable row level security;
create policy "Anyone can read reviews"
  on public.reviews for select using (true);
create policy "Reviewer inserts review on released order"
  on public.reviews for insert with check (
    auth.uid() = reviewer_id
    and exists (
      select 1 from public.marketplace_orders o
      where o.id = order_id
        and o.status = 'released'
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

------------------------------------------------------------
-- payouts
------------------------------------------------------------
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  knitter_id uuid not null references public.profiles(id) on delete cascade,
  stripe_transfer_id text unique not null,
  amount_nok int not null,
  arrival_date date,
  status text not null,
  created_at timestamptz not null default now()
);
create index payouts_knitter_idx on public.payouts(knitter_id, created_at desc);

alter table public.payouts enable row level security;
create policy "Knitter reads own payouts"
  on public.payouts for select using (auth.uid() = knitter_id);

------------------------------------------------------------
-- child_profiles (optional helper for commission requests)
------------------------------------------------------------
create table public.child_profiles (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null,
  birth_date date,
  chest_cm int,
  length_cm int,
  head_circ_cm int,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index child_profiles_parent_idx on public.child_profiles(parent_id);

create trigger child_profiles_set_updated_at
  before update on public.child_profiles
  for each row execute function public.set_updated_at();

alter table public.child_profiles enable row level security;
create policy "Parent reads own children"
  on public.child_profiles for select using (auth.uid() = parent_id);
create policy "Parent writes own children"
  on public.child_profiles for all using (auth.uid() = parent_id) with check (auth.uid() = parent_id);
