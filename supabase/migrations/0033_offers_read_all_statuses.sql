-- Allow anyone to read the accepted offer on a commission request,
-- so the public detail page can show who was chosen.
-- (The old "Anyone reads offers on visible requests" was dropped in 0019.)

create policy "Anyone reads accepted offer"
  on public.commission_offers for select
  using (
    status = 'accepted'
    and exists (
      select 1 from public.commission_requests r
      where r.id = request_id
        and r.status in ('awaiting_payment', 'awaiting_yarn', 'awarded', 'completed', 'delivered')
    )
  );
