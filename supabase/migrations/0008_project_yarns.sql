-- Link table between projects and yarns from the stash.
--
-- When a project's status flips to 'finished', the associated grams_used
-- get subtracted from yarns.total_grams (auto-deduction). The deducted_at
-- timestamp guards against double-deduction if the user toggles the
-- status repeatedly.

create table public.project_yarns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  yarn_id uuid not null references public.yarns(id) on delete restrict,
  grams_used int not null check (grams_used >= 0),

  -- Non-null while the deduction is currently applied. Cleared when the
  -- project's status flips away from 'finished' so the grams flow back.
  deducted_at timestamptz,

  created_at timestamptz not null default now(),
  unique (project_id, yarn_id)
);

create index project_yarns_project_idx on public.project_yarns(project_id);
create index project_yarns_yarn_idx on public.project_yarns(yarn_id);

alter table public.project_yarns enable row level security;

-- Owners are identified through the parent project / yarn, so the policy
-- joins via the parent tables.
create policy "Owners select own project yarns"
  on public.project_yarns for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_yarns.project_id and p.user_id = auth.uid()
    )
  );

create policy "Owners insert own project yarns"
  on public.project_yarns for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_yarns.project_id and p.user_id = auth.uid()
    )
    and exists (
      select 1 from public.yarns y
      where y.id = project_yarns.yarn_id and y.user_id = auth.uid()
    )
  );

create policy "Owners update own project yarns"
  on public.project_yarns for update using (
    exists (
      select 1 from public.projects p
      where p.id = project_yarns.project_id and p.user_id = auth.uid()
    )
  );

create policy "Owners delete own project yarns"
  on public.project_yarns for delete using (
    exists (
      select 1 from public.projects p
      where p.id = project_yarns.project_id and p.user_id = auth.uid()
    )
  );
