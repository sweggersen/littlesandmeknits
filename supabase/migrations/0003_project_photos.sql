-- Phase 2: project photos + free-text "external" pattern title.
--
-- Bucket is public so the same URL works for owner viewing and shared
-- pages. Path layout: <user_id>/<project_id>/<random>.<ext>, so paths
-- are unguessable for non-shared projects even though the bucket
-- itself is public.

alter table public.projects
  add column if not exists pattern_external text;

insert into storage.buckets (id, name, public)
values ('projects', 'projects', true)
on conflict (id) do nothing;

-- Authenticated users may upload, replace, and delete files inside
-- their own user-id-prefixed folder.
create policy "Owners upload own project photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'projects'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners update own project photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'projects'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners delete own project photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'projects'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Public read project photos"
  on storage.objects for select to public
  using (bucket_id = 'projects');
