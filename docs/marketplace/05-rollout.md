# 05 — Phased rollout

## Sequencing principle

Pre-loved first, commissions last. Reasoning:
- Pre-loved has the lowest stakes (used items, low price points), so
  trust failures are recoverable.
- Pre-loved generates supply fast (every existing user has a closet).
- Commissions need the most platform infrastructure (escrow, dispute,
  in-progress milestones, messaging) and require trust accumulated
  from earlier phases.

Each phase has a clear **exit criterion** — what has to be true to
move to the next.

## Phase 0 — Foundations (2–3 weeks)

**Build, no users yet.**

Scope:
- Migrations 0010 (`knitter_profiles`) + 0013 (`marketplace_orders`)
  + 0011 (`listings`) only — minimum to support pre-loved
- `src/lib/stripe-connect.ts` + onboarding routes
- `src/pages/studio/marked/innstillinger.astro` (Connect onboarding)
- Webhook extension: `account.updated`, `payment_intent.succeeded`
  for marketplace orders, `transfer.created`, `transfer.failed`
- Admin tooling (rough): SQL scripts + Supabase dashboard for
  suspension. No admin UI yet.
- Marketplace bucket in Supabase storage with photo upload helper

Exit when:
- Sam can onboard herself as a knitter
- Sam can publish a test listing
- A test buyer can pay; funds land on platform balance
- Manual transfer to Sam's Connect account succeeds
- Refund flow works

## Phase 1 — Pre-loved private beta (3–4 weeks)

**20–30 hand-picked sellers from existing audience.**

Scope:
- Public `/marked/brukt` page (pre-loved only)
- Listing creation flow on `/studio/marked/listing/ny`
- Buyer purchase flow → checkout → confirmation
- Seller fulfillment view (mark shipped, paste tracking)
- Auto-release timer (Cloudflare cron or `pg_cron`)
- ★ ratings + reviews
- Report button → email to Sam
- "Hva er Marked?" help page
- Pre-loved-only fee tier active

Promotional cap on first 50 sellers: 0% fee for first 5 sales each.

Exit when:
- ≥ 30 listings live
- ≥ 20 completed orders
- Dispute rate < 5%
- Auto-release timer fires correctly on at least 5 orders
- No critical bugs open for > 48h

## Phase 2 — Pre-loved public + ready-made (4–6 weeks)

**Open the floodgates on pre-loved; introduce ready-made.**

Scope:
- Remove invite gate on pre-loved
- Ready-made listing flow (same form, different `kind`)
- `/marked/nytt` listing surface
- EN 14682 disclosure checkbox on ready-made
- Saved searches + push notifications (web push only — `iOS` PWA push
  is iffy; iOS users get email)
- Knitter directory `/strikkere`
- Public knitter profile `/strikkere/:slug` with portfolio carry-over
  from `projects` table
- Vipps via Stripe (if available in NO at integration time)

Exit when:
- ≥ 100 active listings
- ≥ 50 active sellers
- ≥ 5% of pattern PDF buyers have visited `/marked` within 14d
- NPS or qualitative feedback positive enough to add commissions
- MVA / accounting workflow validated with at least one MVA-registered
  seller

## Phase 3 — Commissions (5–8 weeks)

**The hardest pillar.**

Scope:
- Migrations 0012 (`commission_requests`, `commission_offers`)
  + 0014 (`order_messages`, `order_events`) + 0016 (`child_profiles`)
- `/marked/oppdrag` open requests board
- Commission request creation `/studio/oppdrag/ny`
- Knitter offer flow
- Order chat (`order_messages`) on every commission order
- `in_progress` status with WIP photo posting
- Targeted commission via `/strikkere/:slug` "Be om tilbud"
- Buyer-to-seller dispute flow + admin resolution (still SQL-driven
  for now — no admin UI)

Exit when:
- ≥ 10 commission orders completed and released
- Average dispute resolution time < 72h
- ≥ 1 buyer has used the same knitter twice (signal of repeat trust)

## Phase 4 — Pattern → commission funnel (3–4 weeks)

**Activate the moat.**

Scope:
- On every `/oppskrifter/[slug]` page: "Vil du at noen skal strikke
  den for deg?" section
- Up to 5 active ready-made listings + a pre-filled "Bestill
  ferdigstrikket" CTA
- Ranking algorithm: knitters with verified badge, avg ★ ≥ 4.5,
  open availability, prefer knitters who've completed *this* pattern
  before
- Track click-through and conversion as a first-class metric

Exit when:
- ≥ 5% of pattern PDF buyers click the funnel within 14d
- ≥ 2% of pattern PDF buyers complete a commission within 60d
- Funnel converts at ≥ 1.5x non-funnel commission post rate

## Phase 5 — Polish & scale (continuous)

**Once the marketplace is healthy.**

Pick from this menu based on what's hurting most:
- Admin UI for moderation, suspension, refunds
- Bulk listing import (for sellers emptying full closets)
- "Følg strikker" notification subscription (no public follow graph,
  just personal subscribe)
- Multi-photo carousel parity with `projects`
- Address book in buyer profile
- Inntektsrapport CSV export
- Sweden + Denmark expansion (shipping zones, tax recalc)
- Vipps-direct integration if Stripe Vipps not viable

## Risks per phase

| Phase | Top risk | Mitigation |
| --- | --- | --- |
| 0 | Stripe Connect onboarding friction blocks Sam | Test with own bank account first; document |
| 1 | Sellers list, no buyers | Promote to existing newsletter list pre-launch |
| 2 | Ready-made vs pre-loved confusion in UI | Strong category labeling + separate landing pages |
| 3 | Disputes overwhelm Sam | Auto-release + 48h SLA with clear escalation |
| 4 | Pattern page becomes ad surface, hurts PDF sales | Soft placement below main CTA; A/B test |
| 5 | Scope creep | Stop. Re-prioritize on actual user signal. |

## What we **don't** do (per phase)

- Phase 1: no commissions, no ready-made, no Vipps, no admin UI, no
  push notifications, no saved searches
- Phase 2: no commissions, no chat (still listing-driven only)
- Phase 3: no admin UI, no insurance, no dispute appeal process
- Phase 4: no advanced ranking ML, no recommender system
- Phase 5: no expansion outside knitting, no follow graph

## Estimated total: 17–25 weeks for Phases 0–4

That's 4–6 months of focused work. Realistic for one full-time
builder; longer if Sam is also designing patterns and parenting four
kids. **Phase 1 alone (~6–8 weeks total with Phase 0) is enough to
validate the bet** before sinking more time.
