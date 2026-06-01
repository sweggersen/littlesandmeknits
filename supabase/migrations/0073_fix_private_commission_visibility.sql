-- R2-1 caught a real privacy bug while pinning RLS coverage on the
-- new profile-split tables.
--
-- commission_requests had TWO overlapping SELECT policies (RLS OR's
-- them together), and the broader one ignored target_knitter_id:
--
--   policy 1 (correct):
--     status = 'open' AND (target_knitter_id IS NULL OR target_knitter_id = auth.uid())
--
--   policy 2 (broken, from 0022_yarn_shipping_fields):
--     status IN ('open', 'awaiting_payment', 'awaiting_yarn', 'awarded',
--                'completed', 'delivered')
--
-- Result: any authenticated user could see "private" targeted requests
-- because policy 2 grants access to all `open` rows regardless of the
-- target. The private-commission feature wasn't actually private.
--
-- Fix: replace both with a single policy that handles every state.

begin;

drop policy if exists "Anyone reads open requests" on public.commission_requests;
drop policy if exists "Authenticated reads open or in-progress requests" on public.commission_requests;

-- Security-definer helper so a SELECT policy on commission_requests
-- can ask "is the current user the accepted knitter on this request?"
-- without triggering RLS recursion through commission_offers (whose
-- own policies look back at commission_requests).
create or replace function public.is_accepted_knitter(req_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.commission_offers
    where request_id = req_id
      and knitter_id = auth.uid()
      and status = 'accepted'
  );
$$;

-- Single SELECT policy. Splits on status:
--   * 'open'  → visible to everyone, except private (target_knitter_id)
--               which is visible only to the targeted knitter.
--   * 'awaiting_payment' / 'awaiting_yarn' / 'awarded' / 'completed' /
--     'delivered' → visible to participants only (buyer, accepted knitter).
--   * 'frozen' / 'rejected' / 'pending_review' → owner only.
create policy "commission_requests select"
  on public.commission_requests for select
  using (
    -- Public open: visible to everyone *unless* private and not the target.
    (status = 'open' and (target_knitter_id is null or target_knitter_id = auth.uid()))
    -- The owner always reads their own request (any status).
    or auth.uid() = buyer_id
    -- Accepted knitter reads in-progress states via the helper.
    or (
      status in ('awaiting_payment', 'awaiting_yarn', 'awarded', 'completed', 'delivered')
      and public.is_accepted_knitter(id)
    )
  );

commit;
