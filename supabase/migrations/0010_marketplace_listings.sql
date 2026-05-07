-- Marketplace listings: classifieds-style ads for pre-loved (brukt) and
-- ready-made (nytt) knitted garments. Any registered user can post.
-- Publishing requires a small listing fee paid via Stripe Checkout.
-- Buyer and seller arrange payment and shipping themselves.

create type public.listing_kind as enum ('pre_loved', 'ready_made');
create type public.listing_status as enum ('draft', 'active', 'sold', 'removed');
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
  constraint listings_condition_for_pre_loved
    check ((kind = 'pre_loved' and condition is not null)
           or (kind = 'ready_made' and condition is null)),

  pattern_slug text,
  pattern_external_title text,
  yarn_ids uuid[] not null default '{}',
  colorway text,

  photos text[] not null default '{}',
  hero_photo_path text,

  location text,
  shipping_info text,

  listing_fee_session_id text unique,
  listing_fee_nok int,

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

create policy "Public reads active listings"
  on public.listings for select using (status = 'active');

create policy "Seller reads own listings"
  on public.listings for select using (auth.uid() = seller_id);

create policy "Seller inserts own listings"
  on public.listings for insert with check (auth.uid() = seller_id);

create policy "Seller updates own listings"
  on public.listings for update using (auth.uid() = seller_id);

create policy "Seller deletes own draft listings"
  on public.listings for delete using (auth.uid() = seller_id and status = 'draft');
