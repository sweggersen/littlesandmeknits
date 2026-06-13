-- Append-only money ledger (Phase D, see docs/ORDERS_MIGRATION.md).
--
-- Every money-state transition across BOTH commerce flows — listing escrow
-- (orders) and commission payments (commission_requests) — appends one row
-- here. The orders/commission tables hold the CURRENT state; this table holds
-- the HISTORY: when money was authorized, captured, released, refunded,
-- cancelled, or disputed, by whom, for how much, and via which Stripe object.
--
-- Purpose: support can answer "where did this money go / why is it stuck",
-- finance can reconcile against Stripe, and the money state machine becomes
-- greppable in one place instead of reconstructed from scattered timestamps.
--
-- Append-only by construction: no UPDATE/DELETE policy, services only INSERT.
-- A correction is a new compensating row, never an edit — the audit trail is
-- the point.

create type public.payment_event_type as enum (
  'reserved',          -- funds authorized & held (listing manual-capture hold)
  'captured',          -- funds captured (listing: shipped; commission: paid into platform)
  'released',          -- escrow released to recipient (listing: delivered; commission: transfer to knitter)
  'refunded',          -- money returned to the buyer
  'cancelled',         -- authorization voided without capture (ship-deadline / auth expiry)
  'dispute_opened',    -- buyer dispute or Stripe chargeback opened
  'dispute_resolved'   -- dispute closed (refund or release decided)
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),

  -- Which flow this belongs to. Disambiguates the entity reference below.
  kind text not null check (kind in ('listing', 'commission')),
  event_type public.payment_event_type not null,

  -- Entity reference. Deliberately NOT a foreign key: an audit ledger must
  -- survive deletion of the entity it records (and must never block that
  -- deletion). Exactly one is set, by flow.
  order_id uuid,
  commission_request_id uuid,

  -- Who triggered the transition. NULL = system (Stripe webhook / cron).
  actor_id uuid references public.profiles(id) on delete set null,

  -- Money snapshot at the moment of the event (NOK integers; ore only ever
  -- lives inside Stripe calls). amount_nok = gross moved; fee_nok = the
  -- platform's cut of it. Net to the recipient = amount_nok - fee_nok.
  amount_nok int,
  fee_nok int,

  -- Stripe correlation. The PI ties the whole lifecycle together; the object
  -- id is the specific transfer / refund / dispute / charge for this event.
  stripe_payment_intent_id text,
  stripe_object_id text,

  -- Anything else support needs to retrace (sanitised — no card data, no PII
  -- beyond ids). Schema-less so callers put what's useful.
  context jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  -- Exactly one entity per row. Evaluated only at INSERT (no FK cascade can
  -- re-trigger it), so it cannot interfere with entity deletion.
  constraint payment_events_one_entity check (
    (order_id is not null)::int + (commission_request_id is not null)::int = 1
  )
);

create index payment_events_order      on public.payment_events(order_id, occurred_at desc);
create index payment_events_commission on public.payment_events(commission_request_id, occurred_at desc);
create index payment_events_pi         on public.payment_events(stripe_payment_intent_id);
create index payment_events_kind_type  on public.payment_events(kind, event_type, occurred_at desc);

alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon;   -- ledger: zero anon surface

-- Staff-only read; mirrors dead_letter_events. The SECURITY DEFINER helper
-- (0037) never reads profiles columns under the caller's grants (the
-- 0077/0080 outage class). End users see their order/commission status; they
-- do not need the raw money ledger.
create policy payment_events_staff_read on public.payment_events for select to authenticated
  using (public.is_admin_or_moderator((select auth.uid())));

-- No INSERT/UPDATE/DELETE policy: every write goes through the service layer
-- (service_role), and there is intentionally no path to mutate a recorded
-- event — corrections are new rows.
