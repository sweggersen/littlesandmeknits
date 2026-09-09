-- 0111: version-control the private `patterns` storage bucket (paid pattern
-- PDFs). It was originally created via the Supabase dashboard (see the comment
-- in 0001), so its private flag lived ONLY there — a fresh or misconfigured
-- environment could ship it public and leak paid content, with no migration or
-- test to catch it. Assert here, idempotently, that it exists and is PRIVATE.
--
-- Access stays via short-lived signed URLs minted server-side (checkout.ts
-- getDownloadUrl). Signed URLs bypass RLS, so no public/anon SELECT policy on
-- storage.objects is needed for this bucket — and none exists (the 0003
-- public-read policy is scoped to bucket_id = 'projects'). Uploads go through
-- the service-role client, which also bypasses RLS.

insert into storage.buckets (id, name, public)
values ('patterns', 'patterns', false)
on conflict (id) do update set public = false;
