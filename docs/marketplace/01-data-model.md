# 01 — Data model

## Principles

- **Additive.** No table renames; existing `profiles`, `projects`,
  `yarns`, `needles`, `external_patterns`, `purchases` stay as-is.
- **One orders table.** Pre-loved, ready-made, and commission orders
  all flow through `marketplace_orders`. The `kind` enum branches
  behavior; the columns are mostly the same.
- **RLS-first.** Every table has Row-Level Security. Buyers see their
  orders; sellers see theirs. The webhook/service role bypasses RLS
  for state transitions, mirroring how `purchases` already works.
- **No soft deletes for v1.** Use status enums for canceled/refunded;
  hard-delete only on user request (GDPR right to erasure).

## Entity overview

```
profiles ─────────┐                 (existing)
                  │
                  ▼
          knitter_profiles  ◄── seller-side extension
                  │
        ┌─────────┴──────────┐
        ▼                    ▼
   listings           commission_requests
   (pre-loved +              │
   ready-made)               ▼
        │            commission_offers ──► chosen ──┐
        │                                            │
        └────────────────► marketplace_orders ◄──────┘
                                  │
                ┌─────────────────┼──────────────────┐
                ▼                 ▼                  ▼
          order_messages    order_events         reviews
                                  │
                                  ▼
                              payouts
```

## Tables

### `knitter_profiles` (1:1 with `profiles`)
Seller-side opt-in. A row exists only when a user toggles "Bli strikker."

| column | type | notes |
| --- | --- | --- |
| `user_id` | uuid PK FK→profiles | |
| `slug` | text unique | public URL: `/strikkere/<slug>` |
| `bio` | text | markdown |
| `specialties` | text[] | `['baby','barn','voksen','tilbehor']` |
| `availability` | enum | `open`, `waitlist`, `closed` |
| `turnaround_weeks_min` / `_max` | int | self-reported |
| `hourly_rate_nok` | int nullable | optional, mostly informational |
| `accepts_commissions` | bool | gates commission flow |
| `accepts_yarn_provided_by_buyer` | bool | |
| `stripe_account_id` | text | Stripe Connect Express |
| `stripe_charges_enabled` | bool | from Connect webhook |
| `stripe_payouts_enabled` | bool | from Connect webhook |
| `mva_registered` | bool | self-declared; affects tax math |
| `org_number` | text nullable | foretak/enkeltpersonforetak |
| `display_country` | text | default `'NO'` |
| `created_at` / `updated_at` | timestamptz | |

RLS: anyone can `select` rows where `availability != 'closed'` (public
profile); only owner can `update`. Insert via API after onboarding.

### `listings` (pre-loved + ready-made)
| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `seller_id` | uuid FK→profiles | |
| `kind` | enum | `pre_loved`, `ready_made` |
| `title` | text | |
| `description` | text | markdown |
| `price_nok` | int | gross to buyer (incl. fee passthrough decision — see 02) |
| `currency` | text | default `'NOK'` |
| `size_label` | text | e.g. `'92'`, `'2 år'`, `'S'` |
| `size_age_months_min` / `_max` | int nullable | for kids' search |
| `category` | enum | `genser`, `cardigan`, `lue`, `votter`, `sokker`, `teppe`, `kjole`, `bukser`, `annet` |
| `condition` | enum nullable | only for `pre_loved`: `som_ny`, `lite_brukt`, `brukt`, `slitt` |
| `pattern_slug` | text nullable | links to a Sam-designed pattern if applicable |
| `pattern_external_title` | text nullable | free text for non-Sam patterns |
| `yarn_ids` | uuid[] | references existing `yarns` rows where known |
| `colorway` | text | freeform |
| `photos` | text[] | storage paths in `marketplace` bucket |
| `hero_photo_path` | text | denormalized for list views |
| `shipping_options` | jsonb | array of `{carrier, service, price_nok, days}` |
| `status` | enum | `draft`, `active`, `reserved`, `sold`, `removed` |
| `published_at` | timestamptz nullable | |
| `sold_at` | timestamptz nullable | |
| `created_at` / `updated_at` | timestamptz | |

RLS: anyone can `select` where `status = 'active'`; owner sees all
their own statuses; only owner can `update`/`insert`/`delete`.

Indexes: `(status, kind, category)`, `(seller_id)`, `(pattern_slug)`,
`(size_age_months_min, size_age_months_max)`.

### `commission_requests` (open requests board)
Buyer-posted "I want this knitted."

| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `buyer_id` | uuid FK→profiles | |
| `title` | text | |
| `description` | text | markdown |
| `pattern_slug` | text nullable | preferred Sam pattern |
| `pattern_external_title` | text nullable | |
| `size_label` / `size_age_months_*` | as above | |
| `colorway` | text | |
| `yarn_ids` | uuid[] | preferred yarns from catalog |
| `yarn_provided_by_buyer` | bool | buyer ships yarn to knitter |
| `budget_nok_min` / `_max` | int | range |
| `needed_by` | date nullable | "trenger til 1. september" |
| `status` | enum | `open`, `awarded`, `cancelled`, `expired` |
| `awarded_offer_id` | uuid FK→commission_offers nullable | |
| `created_at` / `updated_at` | timestamptz | |
| `expires_at` | timestamptz | default now()+30d |

RLS: anyone authenticated can `select` `open` requests; only buyer
can `update`/`cancel`.

### `commission_offers`
Knitter responds to a request.

| column | type |
| --- | --- |
| `id` | uuid PK |
| `request_id` | uuid FK→commission_requests |
| `knitter_id` | uuid FK→profiles |
| `price_nok` | int |
| `turnaround_weeks` | int |
| `message` | text |
| `status` | enum: `pending`, `accepted`, `declined`, `withdrawn` |
| `created_at` | timestamptz |

RLS: request buyer + offering knitter can `select`; only knitter can
`insert`/`withdraw`; only buyer can `accept`/`decline`.

### `marketplace_orders` (the central transaction record)
| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `kind` | enum | `pre_loved`, `ready_made`, `commission` |
| `buyer_id` | uuid FK→profiles | |
| `seller_id` | uuid FK→profiles | |
| `listing_id` | uuid FK→listings nullable | |
| `commission_offer_id` | uuid FK→commission_offers nullable | |
| `gross_nok` | int | what buyer pays |
| `platform_fee_nok` | int | what we take |
| `net_to_seller_nok` | int | gross − fee − Stripe fees |
| `currency` | text | `'NOK'` |
| `stripe_payment_intent_id` | text unique | |
| `stripe_application_fee_id` | text nullable | |
| `shipping_address` | jsonb | snapshot — name, gate, postnr, sted |
| `shipping_carrier` | text | `'posten'`, `'bring'`, etc. |
| `shipping_tracking` | text nullable | |
| `status` | enum | see lifecycle below |
| `disputed_at` / `dispute_reason` | timestamptz / text | |
| `created_at` / `paid_at` / `shipped_at` / `delivered_at` / `released_at` / `refunded_at` | timestamptz | |

Order status lifecycle (one enum):
```
draft → pending_payment → paid → in_progress (commissions only)
                                      ↓
                                   shipped → delivered → released
                                                          (= seller paid out)
any of the above → disputed → refunded | released (resolution)
                → cancelled
```

RLS: buyer sees own; seller sees own; mutations via API/webhooks.

### `order_messages`
In-app DM thread per order.

| `id` `order_id` `sender_id` `body` `created_at` `read_at` |

RLS: only buyer + seller of the order can `select`/`insert`.

### `order_events` (audit log)
Every state change, who triggered it, raw payload.
Useful for dispute resolution.

### `reviews`
| `id` `order_id (unique)` `reviewer_id` `subject_id` `direction` (`buyer→seller`|`seller→buyer`) `rating` (1–5) `body` `photos` `created_at` |

RLS: anyone authenticated can `select`; only `reviewer` can `insert`,
and only when the parent order has `status='released'`.

### `payouts`
Mirrors Stripe Connect transfers for knitter dashboard.

| `id` `knitter_id` `stripe_transfer_id` `amount_nok` `arrival_date` `status` |

RLS: only knitter can `select` own.

### `child_profiles` (optional helper, buyer-side)
Saved sizes per child so commission requests pre-fill measurements.

| `id` `parent_id` `nickname` `birth_date` `chest_cm` `length_cm` `head_circ_cm` `notes` |

RLS: only parent.

## Storage buckets

- `marketplace` (private) — listing photos, review photos.
  Public read via signed URLs generated server-side after status check.
- Reuse `projects` bucket for knitter portfolio carry-over (linking
  past finished projects into knitter profile).

## Migration strategy

- Single migration file per concern (mirrors current style: 0001_…,
  0002_…). Don't ship one mega-migration.
- Suggested order:
  - `0010_knitter_profiles.sql`
  - `0011_marketplace_listings.sql`
  - `0012_commission_requests_offers.sql`
  - `0013_marketplace_orders.sql`
  - `0014_order_messages_events.sql`
  - `0015_reviews_payouts.sql`
  - `0016_child_profiles.sql` (optional, ship with commissions)
- Each migration is forward-only and additive. No backfills required
  because the marketplace starts empty.

## Why one orders table, not three

Three pillars share 90% of columns (buyer, seller, money, shipping,
status, Stripe IDs). Splitting forces three webhook handlers, three
review-eligibility checks, three dispute flows. The `kind` enum
branches the few places they actually differ (commission has an
`in_progress` status; pre-loved doesn't). This is the same call
the existing codebase made for `purchases` (pattern PDFs all share
one table even though slugs differ).
