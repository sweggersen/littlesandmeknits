-- Carrier label + shipment number on the order, so a listing seller can
-- generate a real Posten/Bring shipping label (auto-filled with the buyer's
-- address) instead of pasting a free-text tracking code. Mirrors the commission
-- yarn-shipping columns. label_free_code is Bring's printable-label link.
alter table public.orders
  add column if not exists bring_shipment_number text,
  add column if not exists label_free_code text;
