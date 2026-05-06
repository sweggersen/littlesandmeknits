-- Needles inventory: separate from yarns so DPNs / circulars / straights
-- can be tracked with size + length + cable info.

create table public.needles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- 'circular' | 'dpn' | 'straight' — kept loose as text for now so we
  -- can add new types without a migration.
  needle_type text not null,
  size_mm numeric(4,2) not null,
  length_cm int,
  material text,
  brand text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index needles_user_idx on public.needles(user_id, size_mm asc);

create trigger needles_set_updated_at
  before update on public.needles
  for each row execute function public.set_updated_at();

alter table public.needles enable row level security;

create policy "Owners select own needles"
  on public.needles for select using (auth.uid() = user_id);
create policy "Owners insert own needles"
  on public.needles for insert with check (auth.uid() = user_id);
create policy "Owners update own needles"
  on public.needles for update using (auth.uid() = user_id);
create policy "Owners delete own needles"
  on public.needles for delete using (auth.uid() = user_id);
