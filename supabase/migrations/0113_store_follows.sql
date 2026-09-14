-- 0113: follow a store (Butikker Phase 2). A follow subscribes the user to the
-- store's activity: a "Nye fra butikker du følger" feed strip + a
-- store_new_listing notification when the store publishes. Distinct from
-- store_favorites (a bookmark with the new-listing dot); a user may favourite
-- without following, or follow without favouriting. Mirrors seller_follows.

begin;

create table if not exists public.store_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  store_id    uuid not null references public.stores(id)   on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, store_id)
);

comment on table public.store_follows is 'A user follows a store: drives the "butikker du følger" feed + store_new_listing notifications.';

create index if not exists idx_store_follows_store on public.store_follows(store_id);

alter table public.store_follows enable row level security;

-- Follow counts are public (mirrors seller_follows "anyone can read"); a user
-- manages ONLY their own follow rows (positive + negative RLS test).
drop policy if exists store_follows_read on public.store_follows;
create policy store_follows_read on public.store_follows for select using (true);

drop policy if exists store_follows_rw on public.store_follows;
create policy store_follows_rw on public.store_follows for all
  using (follower_id = auth.uid())
  with check (follower_id = auth.uid());

grant select, insert, update, delete on public.store_follows to authenticated;
grant select on public.store_follows to anon;
grant all on public.store_follows to service_role;

-- Denormalised follower_count for display (mirrors stores.favorite_count).
alter table public.stores
  add column if not exists follower_count int not null default 0;

create or replace function public.trg_store_follows_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    update public.stores set follower_count = follower_count + 1 where id = new.store_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.stores set follower_count = greatest(0, follower_count - 1) where id = old.store_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_store_follows_count on public.store_follows;
create trigger trg_store_follows_count
  after insert or delete on public.store_follows
  for each row execute function public.trg_store_follows_count();

commit;
