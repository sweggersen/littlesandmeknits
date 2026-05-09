-- Yarn shipping tracking fields + update RLS to include awaiting_yarn.
-- Run AFTER 0021 has been committed.

alter table public.commission_requests
  add column if not exists yarn_shipped_at timestamptz,
  add column if not exists yarn_tracking_code text,
  add column if not exists yarn_received_at timestamptz;

drop policy if exists "Authenticated reads open or in-progress requests" on public.commission_requests;

create policy "Authenticated reads open or in-progress requests"
  on public.commission_requests for select
  using (status in ('open', 'awaiting_payment', 'awaiting_yarn', 'awarded'));
