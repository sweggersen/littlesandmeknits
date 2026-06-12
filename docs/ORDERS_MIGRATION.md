# Orders extraction — design

**Status:** DONE. Phases A+B+C all shipped 2026-06-12. Because nothing was live
yet, the expand/migrate/contract staging (dual-write + prod soak) was collapsed
into the end state directly: `orders` is the sole source of truth for the
purchase (PII, money, Stripe refs, lifecycle, refund/dispute); `listings` keeps
only `status` (catalog availability projection, written by the order services),
`buyer_id` (current holder), and `sold_at`. Migration 0089 dropped the purchase
columns. The phase narrative below is kept as the rationale; the dual-write
"shadow" framing it describes was the intermediate that the final collapse
removed.

**Author:** staff-review follow-up, 2026-06-12
**Problem:** the purchase/fulfillment entity does not exist as a table. It is ~20 columns
smeared onto `listings`, which simultaneously serves as the public catalog row. Consequences:

1. **PII risk:** `buyer_name/address/postal_code/city` live on a row whose table has a
   `status='active'` public-read policy. Safe today only because row policies gate
   non-active rows and the relist path nulls the PII — i.e. one policy or code slip away
   from exposing a buyer's home address to anon.
2. **Single-sale data loss:** a listing can be sold once, ever. The H2 relist flow
   (ship-deadline release) *overwrites* the purchase trail — prior PI ids, refund and
   dispute history are destroyed on relist.
3. **State-machine sprawl:** `listings.status` mixes catalog states (draft, pending_review,
   active, expired, rejected) with fulfillment states (reserved, shipped, disputed, sold),
   written from 22 call sites across 6+ files.

## Target model

- **`orders`** — one row per purchase attempt. Owns: fulfillment status, money fields,
  Stripe ids, shipping address (PII), refund + dispute sub-state, lifecycle timestamps.
  A listing can have many orders over time; at most ONE open.
- **`listings`** — catalog only. Keeps its `status` enum **as a denormalized display
  mirror** of the open order (so every browse page, card badge, and filter keeps working
  untouched), plus `sold_at` for display. The authoritative fulfillment state is the
  order; services update both in the same operation. PII and money columns are dropped
  at the end (Phase C).

### Why mirror instead of removing fulfillment states from `listings.status`
Removing reserved/shipped/disputed from the listing enum forces every browse surface
(index, brukt, nytt, favorites, seller page, store page, cards) to join `orders` to know
buyability — a much larger, riskier diff for zero data-model benefit. The mirror is
display-only and documented as such; correctness lives on `orders`.

## Schema (migration 0088)

```sql
-- Staff checks reuse public.is_admin_or_moderator() (0037), which is already
-- SECURITY DEFINER — no new helper needed, and the policy never reads
-- profiles columns under the caller's grants (the 0077/0080 outage class).

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
  seller_id  uuid not null references public.profiles(id) on delete restrict, -- denorm: RLS without join
  store_id   uuid references public.stores(id),
  status public.order_status not null default 'reserved',

  -- money (NOK integers; ore only inside Stripe calls)
  item_price_nok   int not null,
  shipping_nok     int not null default 0,
  tb_fee_nok       int not null default 0,
  platform_fee_nok int not null default 0,
  stripe_payment_intent_id text,
  stripe_dispute_id        text,

  -- shipping address (PII lives here, NOT on the catalog row)
  shipping_name text, shipping_address text,
  shipping_postal_code text, shipping_city text,
  tracking_code text,

  -- lifecycle. Two deadlines, two meanings (today auto_release_at is overloaded):
  reserved_at      timestamptz not null default now(),
  ship_deadline_at timestamptz,  -- reserved: release hold if not shipped by then (5d < 7d auth)
  auto_release_at  timestamptz,  -- shipped: auto-confirm delivery at +14d
  shipped_at timestamptz, delivered_at timestamptz, cancelled_at timestamptz,
  cancel_reason text,            -- 'ship_deadline' | 'auth_canceled' | 'refund_accepted' | 'admin_refund'

  -- refund sub-state (fields, not statuses — matches current model)
  refund_requested_at timestamptz, refund_reason text, refund_description text,
  refund_outcome text, refund_notes text, refund_resolved_at timestamptz,

  -- dispute sub-state
  disputed_at timestamptz, dispute_reason text,
  dispute_resolution text, dispute_resolved_at timestamptz,

  created_at timestamptz not null default now()
);

-- THE core invariant the old model couldn't express: many orders per listing
-- over time, at most one in flight.
create unique index orders_one_open_per_listing on public.orders(listing_id)
  where status in ('reserved','shipped','disputed');

create index orders_buyer   on public.orders(buyer_id, created_at desc);
create index orders_seller  on public.orders(seller_id, created_at desc);
create index orders_pi      on public.orders(stripe_payment_intent_id);
create index orders_release on public.orders(status, auto_release_at);
create index orders_shipby  on public.orders(status, ship_deadline_at);
```

### RLS

```sql
alter table public.orders enable row level security;
revoke all on public.orders from anon;                 -- PII table: zero anon surface
-- (0085 default privileges grant authenticated table access; row policies gate rows.)

create policy orders_buyer_read  on public.orders for select to authenticated
  using (buyer_id = auth.uid());
create policy orders_seller_read on public.orders for select to authenticated
  using (seller_id = auth.uid());
create policy orders_staff_read  on public.orders for select to authenticated
  using (public.is_admin_or_moderator((select auth.uid())));
-- NO authenticated insert/update/delete policies: every write goes through the
-- service layer (service_role), which is already the architecture rule.
```

RLS tests (required by CLAUDE.md): buyer reads own ✓, seller reads own ✓, third party
reads nothing ✓, staff reads any ✓, authenticated insert/update rejected ✓, anon select
rejected ✓.

### Backfill (same migration, transactional)

One order per listing that carries purchase data. Status map:
`reserved→reserved`, `shipped→shipped`, `sold→delivered`, `disputed→disputed`.
Deadline split: if `shipped_at is null` the old `auto_release_at` was the ship deadline,
else it was the delivery window.

```sql
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
  case l.status when 'reserved' then 'reserved' when 'shipped' then 'shipped'
                when 'disputed' then 'disputed' else 'delivered' end::public.order_status,
  l.price_nok, coalesce(l.shipping_price_nok, 0), coalesce(l.buyer_tb_fee_nok, 0),
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
where l.buyer_id is not null
   or l.stripe_payment_intent_id is not null
   or l.status in ('reserved','shipped','disputed');
```

(Sold-without-buyer rows — manual "Kan møtes" sales — have `buyer_id null` and are
intentionally NOT backfilled: there was no transaction. `orders.buyer_id` stays NOT NULL.)

## Service refactor plan — three deploys

**Phase A — additive migration only (0088).** Table + helper + RLS + backfill + RLS
tests. Zero code change, zero behavior change, fully forward-compatible. Ships alone so
prod soaks while Phase B is reviewed.

**Phase B — flip the source of truth (the big PR).** Services operate on `orders`,
mirror `listings.status` for display, and keep writing the old listing columns
(dual-write) so rollback = redeploy previous worker:

| Site | Change |
|---|---|
| `completeListingPurchase` | INSERT order (idempotent via the partial unique index: on conflict → no-op, matches today's status-guard semantics) + mirror listing `reserved` |
| `shipListing` / `confirmListingDelivery` / `releaseExpiredReservation` | read/write the open order; mirror listing status; PI lookups move to `orders.stripe_payment_intent_id` |
| `findEscrowByPaymentIntent` (stripe-events) | resolves to an order (listing kind) — chargeback/refund handlers freeze the ORDER and mirror the listing |
| `refunds.ts` / `disputes.ts` | refund + dispute sub-state on the order |
| cron auto-release | 3a queries `orders status='shipped'`, 3b `orders status='reserved'` by the split deadlines |
| Pages: `listing/[id]` (+ Buyer/SellerPostPurchase), `kvittering`, `my-purchases`, `my-listings`, admin disputes | select the open/latest order (buyer address now comes from `orders` — seller still sees it via `orders_seller_read`) |
| Tests | fake-db seeds `orders`; webhook integration test asserts the order row; mutation ranges re-scoped |

**Phase C — drop the old columns (0089).** After Phase B verifies in prod: stop
dual-writing, then drop from `listings`: buyer_*, stripe_payment_intent_id,
stripe_dispute_id, platform_fee_nok, buyer_tb_fee_nok, reserved_at, shipped_at,
tracking_code, auto_release_at, delivered_at, refund_*, dispute_*. Keep: `status`
(display mirror), `sold_at`. Add CI grep gate: `buyer_name|refund_requested_at` must not
appear in a `from('listings')` context.

**Phase D (separate effort, not this migration):** atomic transition RPCs for the money
state machine + append-only `payment_events` audit table. The orders table is the
prerequisite; do not bundle.

## Risks

- **Webhook double-delivery during the B deploy window:** the partial unique index makes
  a duplicate order INSERT fail loudly instead of silently double-reserving — strictly
  better than today.
- **In-flight purchases during B:** an order reserved pre-B (listing columns only) is
  backfilled by A, so B's reads find it. Sessions created pre-A and completing post-B:
  `completeListingPurchase` inserts the order at webhook time — no gap.
- **Rollback:** A is additive. B dual-writes, so rolling back the worker restores the
  old read path against still-fresh listing columns. C is the point of no return — gate
  it on a week of clean prod soak + `dead_letter_events` quiet.
- **commission_requests** has the same disease (same-named columns). Same pattern later;
  explicitly out of scope here.
