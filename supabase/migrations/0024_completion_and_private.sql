-- Completion timestamps, private commissions, and RLS updates.
-- Run AFTER 0023 has been committed.

-- Private commissions: buyer can target a specific knitter
alter table public.commission_requests
  add column if not exists target_knitter_id uuid references public.profiles(id) on delete set null;

-- Completion tracking
alter table public.commission_requests
  add column if not exists completed_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists auto_release_at timestamptz;

create index if not exists idx_commission_requests_target_knitter
  on public.commission_requests(target_knitter_id)
  where target_knitter_id is not null;

-- Update "Anyone reads open requests" to hide private requests from non-targets
drop policy if exists "Anyone reads open requests" on public.commission_requests;

create policy "Anyone reads open requests"
  on public.commission_requests for select
  using (
    status = 'open'
    and (target_knitter_id is null or target_knitter_id = auth.uid())
  );

-- Update status visibility to include completed + delivered
drop policy if exists "Authenticated reads open or in-progress requests" on public.commission_requests;

create policy "Authenticated reads open or in-progress requests"
  on public.commission_requests for select
  using (status in ('open', 'awaiting_payment', 'awaiting_yarn', 'awarded', 'completed', 'delivered'));
