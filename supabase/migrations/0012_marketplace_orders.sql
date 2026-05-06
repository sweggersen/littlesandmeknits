-- Marketplace orders: the central transaction record. Pre-loved and
-- ready-made share this table (kind discriminates). Commission orders
-- will reuse it once that pillar lands; commission_offer_id is added
-- now as a nullable column so the constraint shape stabilizes.
--
-- Money: amounts in integer NOK (no øre). Stripe stores amounts in
-- minor units (øre) — convert at the API boundary.
--
-- Lifecycle:
--   draft → pending_payment → paid → in_progress (commissions only)
--                                  → shipped → delivered → released
--   any of the above → disputed → refunded | released
--                    → cancelled

create type public.order_kind as enum ('pre_loved', 'ready_made', 'commission');
create type public.order_status as enum (
  'draft',
  'pending_payment',
  'paid',
  'in_progress',
  'shipped',
  'delivered',
  'released',
  'disputed',
  'refunded',
  'cancelled'
);

create table public.marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  kind public.order_kind not null,

  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,

  listing_id uuid references public.listings(id),
  -- commission_offer_id will be wired up when the commissions migration
  -- lands. Nullable now; the orders_one_source check enforces exactly
  -- one source.
  commission_offer_id uuid,
  constraint orders_one_source check (
    (listing_id is not null) <> (commission_offer_id is not null)
  ),

  -- Amounts in whole NOK.
  gross_nok int not null check (gross_nok >= 0),
  shipping_nok int not null default 0 check (shipping_nok >= 0),
  platform_fee_nok int not null default 0 check (platform_fee_nok >= 0),
  net_to_seller_nok int not null default 0 check (net_to_seller_nok >= 0),
  currency text not null default 'NOK',

  -- Stripe references. payment_intent_id is set on order creation;
  -- transfer_id is set when funds are released to the seller.
  stripe_payment_intent_id text unique,
  stripe_transfer_id text unique,

  shipping_address jsonb,
  shipping_carrier text,
  shipping_tracking text,

  status public.order_status not null default 'draft',
  disputed_at timestamptz,
  dispute_reason text,

  created_at timestamptz not null default now(),
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  cancelled_at timestamptz
);

create index orders_buyer_idx on public.marketplace_orders(buyer_id, created_at desc);
create index orders_seller_idx on public.marketplace_orders(seller_id, created_at desc);
create index orders_status_idx on public.marketplace_orders(status, created_at desc);
create index orders_listing_idx on public.marketplace_orders(listing_id) where listing_id is not null;

alter table public.marketplace_orders enable row level security;

create policy "Buyer reads own orders"
  on public.marketplace_orders for select using (auth.uid() = buyer_id);

create policy "Seller reads own orders"
  on public.marketplace_orders for select using (auth.uid() = seller_id);

-- Mutations (insert/update) are intentionally NOT exposed via RLS.
-- They run from API routes with the service-role key after auth checks,
-- mirroring how the existing `purchases` table is mutated only by the
-- Stripe webhook.
