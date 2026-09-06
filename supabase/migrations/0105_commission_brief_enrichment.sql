-- Commission brief enrichment (Phase 1): give the requester (bestiller) a way to
-- hand knitters a clearer spec on an Oppdrag — reference/inspiration images, an
-- optional pattern reference (a name and/or a link, NOT a hosted PDF), and an
-- opt-in "require an agreement before payment" flag.
--
-- Phase 1 ONLY: this is purely descriptive. `requires_agreement` is surfaced to
-- knitters but NOT yet wired into the accept -> pay -> escrow flow. Phase 2 adds
-- the agreement snapshot / sign-off checkpoint. The escrow paths are untouched.

begin;

------------------------------------------------------------
-- New columns on commission_requests
------------------------------------------------------------
alter table public.commission_requests
  add column if not exists pattern_reference text,
  add column if not exists requires_agreement boolean not null default false;

------------------------------------------------------------
-- commission_request_photos: reference/inspiration images for a request.
-- Mirrors listing_photos (0013).
------------------------------------------------------------
create table if not exists public.commission_request_photos (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.commission_requests(id) on delete cascade,
  path text not null,
  position int not null default 0,
  created_at timestamptz default now()
);

create index if not exists idx_commission_request_photos_request
  on public.commission_request_photos (request_id, position);

alter table public.commission_request_photos enable row level security;

-- Grants: mirror commission_requests (0044) — anon may SELECT (RLS still gates
-- it to open, public requests), authenticated gets full CRUD (RLS gates rows),
-- service_role bypasses RLS. anon writes stay revoked (0077/0078 posture).
grant select on public.commission_request_photos to anon;
grant select, insert, update, delete on public.commission_request_photos to authenticated;
grant select, insert, update, delete on public.commission_request_photos to service_role;

------------------------------------------------------------
-- RLS: commission_request_photos
------------------------------------------------------------

-- SELECT: match the PARENT request's visibility EXACTLY (staff read is the
-- separate policy below, RLS OR's them). RLS does not cascade into a policy's
-- EXISTS subquery (that runs as the table owner), so we replicate the parent's
-- conditions here rather than lean on commission_requests' own policies. This
-- reproduces 0073 "commission_requests select": open+public/target, the owner
-- (any status), and the accepted knitter on in-progress states (via the
-- is_accepted_knitter definer helper, which also dodges RLS recursion).
create policy "Read commission request photos"
  on public.commission_request_photos for select
  using (
    exists (
      select 1 from public.commission_requests r
      where r.id = request_id
        and (
          (r.status = 'open' and (r.target_knitter_id is null or r.target_knitter_id = auth.uid()))
          or auth.uid() = r.buyer_id
          or (
            r.status in ('awaiting_payment', 'awaiting_yarn', 'awarded', 'completed', 'delivered')
            and public.is_accepted_knitter(r.id)
          )
        )
    )
  );

-- INSERT/UPDATE/DELETE: ONLY the request's buyer (owner). Column-pinned
-- WITH CHECK (0097): the new/updated row's request_id must point at a request
-- owned by auth.uid(). A USING-only policy would be a hole — a buyer could
-- attach or move photos onto someone else's request row via a direct PostgREST
-- call (0085 blanket authenticated grant), so INSERT and UPDATE both carry the
-- pinning WITH CHECK.
create policy "Buyer inserts own request photos"
  on public.commission_request_photos for insert to authenticated
  with check (
    exists (
      select 1 from public.commission_requests r
      where r.id = request_id and r.buyer_id = auth.uid()
    )
  );

create policy "Buyer updates own request photos"
  on public.commission_request_photos for update to authenticated
  using (
    exists (
      select 1 from public.commission_requests r
      where r.id = request_id and r.buyer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.commission_requests r
      where r.id = request_id and r.buyer_id = auth.uid()
    )
  );

create policy "Buyer deletes own request photos"
  on public.commission_request_photos for delete to authenticated
  using (
    exists (
      select 1 from public.commission_requests r
      where r.id = request_id and r.buyer_id = auth.uid()
    )
  );

-- Staff read for moderation (mirrors 0094 listing_photos staff read): a
-- moderator reviewing a reported request must see its reference images even
-- when the request is not in a publicly-visible state.
create policy "Staff read all commission request photos"
  on public.commission_request_photos for select to authenticated
  using (public.is_admin_or_moderator((select auth.uid())));

commit;
