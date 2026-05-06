-- Tighten the "Public read shared projects" policies so they only apply
-- to the anon role.
--
-- Original 0002 created these policies without a `to` clause, which makes
-- them apply to every role — including `authenticated`. Postgres OR's
-- policies for the same command, so any logged-in user's SELECT against
-- public.projects matched (auth.uid() = user_id) OR (public_slug is not
-- null) and they could see every other user's shared projects in their
-- own /studio/prosjekter list. Same leak on project_logs.
--
-- Fix: drop and recreate the policies, restricting them to `anon`. The
-- public /p/<slug> page uses the anon Supabase client, so it still
-- works; the studio uses an authenticated client and falls back to the
-- owner-only policy.

drop policy if exists "Public read shared projects" on public.projects;
drop policy if exists "Public read logs of shared projects" on public.project_logs;

create policy "Anon read shared projects"
  on public.projects for select to anon
  using (public_slug is not null);

create policy "Anon read logs of shared projects"
  on public.project_logs for select to anon
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_logs.project_id and p.public_slug is not null
    )
  );
