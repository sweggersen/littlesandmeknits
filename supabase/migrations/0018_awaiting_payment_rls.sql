-- Step 2: Update RLS to include awaiting_payment (run after 0017 is committed)

drop policy if exists "Authenticated reads open or awarded requests" on public.commission_requests;

create policy "Authenticated reads open or in-progress requests"
  on public.commission_requests for select
  using (status in ('open', 'awaiting_payment', 'awarded'));
