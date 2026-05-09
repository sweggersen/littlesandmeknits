-- Make offers private: only the buyer (requestor) sees all offers.
-- Knitters see only their own. Public sees nothing (just the count on the request).

drop policy if exists "Anyone reads offers" on public.commission_offers;
drop policy if exists "Anyone reads offers on visible requests" on public.commission_offers;

-- Buyer reads all offers on their own requests
create policy "Buyer reads offers on own requests"
  on public.commission_offers for select
  using (
    exists (
      select 1 from public.commission_requests r
      where r.id = request_id
        and r.buyer_id = auth.uid()
    )
  );

-- "Knitter reads own offers" already exists from 0015, kept as-is.
