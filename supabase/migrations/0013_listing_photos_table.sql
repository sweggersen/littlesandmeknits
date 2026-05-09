-- Structured listing photos with captions and ordering.
-- Replaces the photos text[] column on listings.

create table public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  path text not null,
  caption text,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create index listing_photos_listing_idx
  on public.listing_photos(listing_id, position);

alter table public.listing_photos enable row level security;

create policy "Anyone reads listing photos"
  on public.listing_photos for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (l.status = 'active' or l.seller_id = auth.uid())
    )
  );

create policy "Seller inserts own listing photos"
  on public.listing_photos for insert with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.seller_id = auth.uid()
    )
  );

create policy "Seller updates own listing photos"
  on public.listing_photos for update using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.seller_id = auth.uid()
    )
  );

create policy "Seller deletes own listing photos"
  on public.listing_photos for delete using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.seller_id = auth.uid()
    )
  );

-- Migrate existing data from photos array
insert into public.listing_photos (listing_id, path, position)
select l.id, p.path, (p.ord - 1)::smallint
from public.listings l,
     unnest(l.photos) with ordinality as p(path, ord)
where array_length(l.photos, 1) > 0;
