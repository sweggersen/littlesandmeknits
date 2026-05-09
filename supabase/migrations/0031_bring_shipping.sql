-- Bring/Posten shipping fields for yarn delivery.

alter table public.commission_requests
  add column if not exists yarn_bring_shipment_number text,
  add column if not exists label_free_code text,
  add column if not exists shipping_price_nok int;
