-- Projects: a knitter's personal log of in-progress + finished pieces.
-- Phase 1: schema, RLS, and indexes only — no photo storage yet.

create type public.project_status as enum (
  'planning',
  'active',
  'finished',
  'frogged'
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  title text not null,
  summary text,
  pattern_slug text,
  recipient text,
  target_size text,
  yarn text,
  needles text,
  status public.project_status not null default 'planning',

  hero_photo_path text,

  -- Set when the project is shared publicly. Phase 3.
  public_slug text unique,

  started_at date,
  finished_at date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  body text not null,
  photos text[] not null default '{}',
  log_date date not null default current_date,

  created_at timestamptz not null default now()
);

create index projects_user_idx on public.projects(user_id, created_at desc);
create index projects_public_slug_idx on public.projects(public_slug)
  where public_slug is not null;
create index project_logs_project_idx on public.project_logs(project_id, log_date desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- RLS
alter table public.projects enable row level security;
alter table public.project_logs enable row level security;

-- Owners: full access to their own rows.
create policy "Owners select own projects"
  on public.projects for select using (auth.uid() = user_id);
create policy "Owners insert own projects"
  on public.projects for insert with check (auth.uid() = user_id);
create policy "Owners update own projects"
  on public.projects for update using (auth.uid() = user_id);
create policy "Owners delete own projects"
  on public.projects for delete using (auth.uid() = user_id);

create policy "Owners select own logs"
  on public.project_logs for select using (auth.uid() = user_id);
create policy "Owners insert own logs"
  on public.project_logs for insert with check (auth.uid() = user_id);
create policy "Owners update own logs"
  on public.project_logs for update using (auth.uid() = user_id);
create policy "Owners delete own logs"
  on public.project_logs for delete using (auth.uid() = user_id);

-- Public read for shared projects (set when public_slug is not null).
create policy "Public read shared projects"
  on public.projects for select using (public_slug is not null);

create policy "Public read logs of shared projects"
  on public.project_logs for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_logs.project_id and p.public_slug is not null
    )
  );
