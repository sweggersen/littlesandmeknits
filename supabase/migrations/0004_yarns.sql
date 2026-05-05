-- Yarn stash: what's in the cupboard.
-- Photo paths reuse the existing `projects` bucket under
-- <user_id>/yarns/<yarn_id>/<...> so the same RLS policy applies.

create table public.yarns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  brand text not null,
  name text not null,
  color text,
  weight text,
  fiber text,

  total_grams int,
  total_meters int,

  notes text,
  photo_path text,

  acquired_at date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index yarns_user_idx on public.yarns(user_id, created_at desc);

create trigger yarns_set_updated_at
  before update on public.yarns
  for each row execute function public.set_updated_at();

alter table public.yarns enable row level security;

create policy "Owners select own yarns"
  on public.yarns for select using (auth.uid() = user_id);
create policy "Owners insert own yarns"
  on public.yarns for insert with check (auth.uid() = user_id);
create policy "Owners update own yarns"
  on public.yarns for update using (auth.uid() = user_id);
create policy "Owners delete own yarns"
  on public.yarns for delete using (auth.uid() = user_id);
