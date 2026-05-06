# 00 — Overview & strategy

## What we're adding (and what we're not)

Littles and Me today is a designer-led app: Sam's patterns, a personal
studio (projects, garn, pinner, bibliotek), and a one-shot Stripe
checkout for pattern PDFs. We are **adding** a peer-to-peer marketplace
on top, not replacing anything. Patterns remain the gravitational center.

## Three pillars

The marketplace is one product but three different transaction shapes.
Each has a different fee, different risk profile, different UI.

### 1. Pre-loved (brukt) — secondhand kids' knitwear
- Lowest stakes, highest liquidity potential.
- Kids outgrow handmade in 6 months; parents hate throwing it away.
- Tiny fee (or flat ~10 NOK under a threshold) to drive volume.
- Probably the right thing to launch first — see `05-rollout.md`.

### 2. Ready-made (nytt) — knitters sell finished items they made on spec
- Knitter casts on what they want, lists when done. Standard e-commerce.
- Medium fee (~8–10%).
- Inventory of one. Each listing is unique.

### 3. Commissions ("strikk for meg") — custom orders
- Buyer posts a request *or* picks from a knitter's open slots.
- Highest fee (~12–15%) — escrow, fitting support, dispute handling.
- The pillar that uniquely benefits from owning the pattern catalog.

## Why this works for Littles and Me specifically

- **The pattern library is a funnel no one else has.** Every pattern
  page can offer "Bestill ferdigstrikket av en av våre strikkere"
  with size, yarn, and color already specified. No other Norwegian
  knitting marketplace can do this because they don't own the patterns.
- **Existing schema is already aimed at this.** `profiles`, `projects`,
  `yarns`, `needles`, `external_patterns` — knitter onboarding is
  mostly toggling a flag and adding seller fields, not net-new data.
- **Norwegian + barneklær is a specific niche.** Etsy is global and
  English; FINN.no has no knitting context; Ravelry doesn't sell.
  There's a real wedge.
- **Brand trust.** Sam's designer reputation acts as the platform's
  reputation in year 1 before peer reviews accumulate.

## Non-goals

- **Not a generic Etsy.** No jewelry, no candles, no non-knitting crafts.
  Knitwear and adjacent (mittens, hats, blankets) only.
- **Not a pattern marketplace for other designers.** The shop side
  stays exclusively Sam's designs (Weggersen Design byline).
- **No global shipping in v1.** Norway only, possibly Sweden/Denmark
  later. Lets us dodge most cross-border tax pain.
- **No live-streaming, no community feed, no follow graph.** The
  studio is a tool, not a social network. Reviews and ratings, yes.
  Likes, comments, follows — out of scope.
- **No drop-shipping or held inventory.** Knitter ships direct to buyer.
  Platform never touches physical goods.

## Success metrics (12-month)

These are aspirational and meant to make tradeoffs concrete, not
forecasts. Pick 1–2 to actually instrument early.

- **Liquidity:** ≥ 50 active sellers, ≥ 200 listings live at any time
- **Match rate:** ≥ 70% of pre-loved listings sell within 30 days
- **Commission funnel:** ≥ 5% of pattern PDF buyers click "Bestill
  ferdigstrikket" within 14 days of purchase
- **Trust:** dispute rate < 2% of completed orders; refund rate < 5%
- **Take rate:** blended platform fee 7–9% of GMV after promotional
  pre-loved discounts

## Strategic risks (named so we're not surprised)

- **Cold-start.** Marketplaces die without supply. Seed by personally
  onboarding 20–30 knitters from existing audience before opening
  buyers. See `05-rollout.md` Phase 0.
- **Sam's time.** Customer support scales linearly with disputes.
  Build the "rapporter problem" flow on day one.
- **Children's clothing safety.** EN 14682 (no cords/drawstrings on
  hood/neck for 0–7y). Not certification, but disclosure required —
  see `04-trust-fees-legal.md`.
- **MVA threshold.** Sole proprietor knitters cross 50 000 NOK/yr =
  must register for MVA. Platform-as-marketplace-facilitator vs
  platform-as-merchant has very different tax shape.
- **Stripe Connect availability.** Norway is supported (Express
  accounts), but knitters need ID + bank for payouts. This is a real
  onboarding speed bump.
