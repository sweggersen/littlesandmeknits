-- Personal pattern library: PDFs and photos of patterns Sam is knitting
-- but didn't design herself (magazines, designer downloads, scans of
-- borrowed booklets). Distinct from the public `oppskrifter` content
-- collection (her own patterns) and from the `pattern_external` text
-- field on projects (which is just a free-text title).
--
-- Storage path under the existing `projects` bucket:
--   <user_id>/external-patterns/<external_pattern_id>/<random>.<ext>

create table public.external_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  title text not null,
  designer text,
  source_url text,
  notes text,

  -- Path to the pattern itself (PDF or image).
  file_path text,
  -- Optional standalone cover image (since PDFs don't render as a thumbnail).
  cover_path text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index external_patterns_user_idx on public.external_patterns(user_id, created_at desc);

create trigger external_patterns_set_updated_at
  before update on public.external_patterns
  for each row execute function public.set_updated_at();

alter table public.external_patterns enable row level security;

create policy "Owners select own external patterns"
  on public.external_patterns for select using (auth.uid() = user_id);
create policy "Owners insert own external patterns"
  on public.external_patterns for insert with check (auth.uid() = user_id);
create policy "Owners update own external patterns"
  on public.external_patterns for update using (auth.uid() = user_id);
create policy "Owners delete own external patterns"
  on public.external_patterns for delete using (auth.uid() = user_id);

-- Let projects link to a row from this library.
alter table public.projects
  add column if not exists external_pattern_id uuid references public.external_patterns(id) on delete set null;
