-- Fix infinite recursion: commission_requests and commission_offers
-- policies referenced each other in a cycle.

-- Drop the circular policy on commission_requests
drop policy if exists "Knitter reads requests with own offers" on public.commission_requests;

-- Drop the circular policy on commission_offers
drop policy if exists "Anyone reads offers on visible requests" on public.commission_offers;

-- Replace with non-circular versions:

-- Knitter reads requests where they have offers (use a non-recursive check)
-- We allow authenticated users to read awarded requests too (needed after acceptance)
create policy "Authenticated reads open or awarded requests"
  on public.commission_requests for select
  using (status in ('open', 'awarded'));

-- Offers: anyone can read offers (prices are public). No subquery back to requests.
create policy "Anyone reads offers"
  on public.commission_offers for select
  using (true);
