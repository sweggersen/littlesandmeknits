-- Extend profiles for marketplace seller features
-- + seller reviews table

-- New columns on profiles
alter table public.profiles
  add column if not exists bio text,
  add column if not exists location text,
  add column if not exists avatar_path text,
  add column if not exists seller_tags text[] not null default '{}',
  add column if not exists profile_visible boolean not null default true;

-- Seller reviews / ratings
create table public.seller_reviews (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamp with time zone default now() not null,
  constraint one_review_per_listing unique (seller_id, reviewer_id, listing_id)
);

alter table public.seller_reviews enable row level security;

create policy "Anyone can read reviews"
  on public.seller_reviews for select using (true);

create policy "Authenticated users can create reviews"
  on public.seller_reviews for insert
  with check (auth.uid() = reviewer_id and auth.uid() <> seller_id);

create policy "Reviewers can update own reviews"
  on public.seller_reviews for update
  using (auth.uid() = reviewer_id);

create policy "Reviewers can delete own reviews"
  on public.seller_reviews for delete
  using (auth.uid() = reviewer_id);

-- Index for fast seller profile lookups
create index if not exists idx_seller_reviews_seller on public.seller_reviews(seller_id);
create index if not exists idx_listings_seller_active on public.listings(seller_id) where status = 'active';
