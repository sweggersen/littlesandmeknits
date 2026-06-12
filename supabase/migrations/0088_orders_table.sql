-- Orders extraction, Phase A (see docs/ORDERS_MIGRATION.md).
--
-- The purchase/fulfillment entity gets its own table. Until now it was ~20
-- columns smeared onto the public catalog row (`listings`): buyer PII next to
-- anon-readable data, a single-sale-per-listing limit (the H2 relist flow
-- overwrites the previous purchase trail), and a status enum mixing catalog
-- and fulfillment states.
--
-- Phase A is ADDITIVE ONLY: create + backfill. No code reads this table yet;
-- Phase B flips the services, Phase C drops the old listing columns.

create type public.order_status as enum (
  'reserved',   -- paid (manual-capture hold), awaiting shipment
  'shipped',    -- captured at ship, delivery window running
  'delivered',  -- buyer confirmed or auto-released (terminal, money with seller)
  'cancelled',  -- hold released: ship deadline / auth expiry / refund (terminal)
  'disputed'    -- frozen pending resolution
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete restrict,
  buyer_id   uuid not null references public.profiles(id) on delete restrict,
  -- Denormalized from the listing so seller RLS needs no join.
  seller_id  uuid not null references public.profiles(id) on delete restrict,
  store_id   uuid references public.stores(id),
  status public.order_status not null default 'reserved',

  -- Money (NOK integers; ore exists only inside Stripe calls).
  item_price_nok   int not null,
  shipping_nok     int not null default 0,
  tb_fee_nok       int not null default 0,
  platform_fee_nok int not null default 0,
  stripe_payment_intent_id text,
  stripe_dispute_id        text,

  -- Shipping address: the PII boundary. Lives here, never on the catalog row.
  shipping_name text,
  shipping_address text,
  shipping_postal_code text,
  shipping_city text,
  tracking_code text,

  -- Lifecycle. The old listings.auto_release_at was overloaded; split it:
  reserved_at      timestamptz not null default now(),
  ship_deadline_at timestamptz,  -- reserved: release the hold if not shipped by then
  auto_release_at  timestamptz,  -- shipped: auto-confirm delivery at +14d
  shipped_at   timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,  -- 'ship_deadline' | 'auth_canceled' | 'refund_accepted' | 'admin_refund'

  -- Refund sub-state (fields, not statuses — matches the existing model).
  refund_requested_at timestamptz,
  refund_reason text,
  refund_description text,
  refund_outcome text,
  refund_notes text,
  refund_resolved_at timestamptz,

  -- Dispute sub-state.
  disputed_at timestamptz,
  dispute_reason text,
  dispute_resolution text,
  dispute_resolved_at timestamptz,

  created_at timestamptz not null default now()
);

-- The invariant the old model couldn't express: many orders per listing over
-- time (relists keep history), at most ONE in flight. Also makes a webhook
-- double-delivery INSERT fail loudly instead of silently double-reserving.
create unique index orders_one_open_per_listing on public.orders(listing_id)
  where status in ('reserved','shipped','disputed');

create index orders_buyer   on public.orders(buyer_id, created_at desc);
create index orders_seller  on public.orders(seller_id, created_at desc);
create index orders_pi      on public.orders(stripe_payment_intent_id);
create index orders_release on public.orders(status, auto_release_at);
create index orders_shipby  on public.orders(status, ship_deadline_at);

-- ── RLS ───────────────────────────────────────────────────────────────
-- PII table: zero anon surface, read-only for the two parties + staff,
-- and NO authenticated write policies — every write goes through the
-- service layer (service_role), which is the standing architecture rule.
alter table public.orders enable row level security;
revoke all on public.orders from anon;

create policy orders_buyer_read on public.orders for select to authenticated
  using (buyer_id = auth.uid());

create policy orders_seller_read on public.orders for select to authenticated
  using (seller_id = auth.uid());

-- is_admin_or_moderator is SECURITY DEFINER (0037), so this policy does not
-- read profiles columns under the caller's grants (the 0077/0080 outage class).
create policy orders_staff_read on public.orders for select to authenticated
  using (public.is_admin_or_moderator((select auth.uid())));

-- ── Backfill ──────────────────────────────────────────────────────────
-- One order per listing that has a real buyer. Manual "Kan møtes" sales have
-- buyer_id null (no transaction happened on-platform) and are intentionally
-- not backfilled. Status map: sold→delivered; the overloaded auto_release_at
-- splits on whether the item ever shipped.
insert into public.orders (
  listing_id, buyer_id, seller_id, store_id, status,
  item_price_nok, shipping_nok, tb_fee_nok, platform_fee_nok,
  stripe_payment_intent_id, stripe_dispute_id,
  shipping_name, shipping_address, shipping_postal_code, shipping_city, tracking_code,
  reserved_at, ship_deadline_at, auto_release_at,
  shipped_at, delivered_at,
  refund_requested_at, refund_reason, refund_description,
  refund_outcome, refund_notes, refund_resolved_at,
  disputed_at, dispute_reason, dispute_resolution, dispute_resolved_at
)
select
  l.id, l.buyer_id, l.seller_id, l.store_id,
  case l.status::text
    when 'reserved' then 'reserved'
    when 'shipped'  then 'shipped'
    when 'disputed' then 'disputed'
    else 'delivered'
  end::public.order_status,
  l.price_nok,
  coalesce(l.shipping_price_nok, 0),
  coalesce(l.buyer_tb_fee_nok, 0),
  coalesce(l.platform_fee_nok, 0),
  l.stripe_payment_intent_id, l.stripe_dispute_id,
  l.buyer_name, l.buyer_address, l.buyer_postal_code, l.buyer_city, l.tracking_code,
  coalesce(l.reserved_at, l.sold_at, now()),
  case when l.shipped_at is null then l.auto_release_at end,
  case when l.shipped_at is not null then l.auto_release_at end,
  l.shipped_at, l.delivered_at,
  l.refund_requested_at, l.refund_reason, l.refund_description,
  l.refund_outcome, l.refund_notes, l.refund_resolved_at,
  l.disputed_at, l.dispute_reason, l.dispute_resolution, l.dispute_resolved_at
from public.listings l
where l.buyer_id is not null;
