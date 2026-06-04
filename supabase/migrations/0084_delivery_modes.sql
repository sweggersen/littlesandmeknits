-- Delivery modes: a listing can be shipped and/or met locally (non-exclusive).
-- Shipping is the ONLY in-app buy path and always uses trygg betaling (escrow);
-- meet = local handover, paid off-platform (Vipps/cash), no protection.
-- shipping_option stays the "kan sendes" indicator (null = meet-only).

alter table public.listings
  add column if not exists can_meet boolean not null default false;

comment on column public.listings.can_meet is
  'Seller offers local handover (paid in person, off-platform, no buyer '
  'protection). Independent of shipping. A listing must offer shipping '
  '(shipping_option not null => escrow_enabled true) and/or can_meet.';
