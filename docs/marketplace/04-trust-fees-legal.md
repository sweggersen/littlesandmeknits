# 04 — Trust, fees & legal

## Fees: full schedule

All percentages are off the gross item price (excludes shipping;
shipping passes through 1:1 to the seller).

| Pillar | Tier | Platform fee | Notes |
| --- | --- | --- | --- |
| Pre-loved | < 200 NOK | flat 10 NOK | encourages the long tail |
| Pre-loved | 200–500 NOK | 5%, min 15 NOK | sweet spot for kids' garments |
| Pre-loved | > 500 NOK | 7% | rare for pre-loved; designer pieces |
| Ready-made | any | 9% | competitive with Etsy 6.5% + payment |
| Commission | any | 13% | reflects escrow + dispute support |
| **Promotional cap (year 1)** | first 50 sellers | 0% for first 5 sales | seed liquidity |

Stripe processing on top: ~1.4% + 1.80 NOK domestic NO cards. Buyer
sees gross only; all fees come out of seller side.

## Trust system

### Verified knitter badge
Earned automatically when:
- Stripe Connect `charges_enabled = true`
- ≥ 3 completed orders with no disputes
- ≥ 1 photo in seller portfolio (carried from `projects` or uploaded)

Badge is reversible — failed disputes or KYC change drops it.

### Ratings
- 1–5 stars, both directions (buyer-to-seller + seller-to-buyer)
- Required at order release (or auto-released after 14 days, no
  rating logged)
- Public on knitter profile; aggregated to a single ★ score
- Buyer-to-seller dimensions: kvalitet, kommunikasjon, leveringstid
- Seller-to-buyer: kommunikasjon, betaling. Less prominent.

### Reviews require completed orders
A review row can only insert when the linked `marketplace_orders.status
= 'released'`. Enforced in RLS (see `01-data-model.md`). No drive-by
reviewing.

### Reporting
Every listing, every order, every profile has "Rapporter" → opens a
form (category: feil produkt, upassende innhold, mistanke om svindel,
annet). Routes to Sam's admin queue. Build this on day one — it's
cheap and the absence of it scales with abuse.

### Suspension policy (write down before launch)
Auto-suspend triggers:
- 3 failed disputes in 90 days
- Stripe `charges_enabled = false`
- 1 confirmed report of counterfeiting / safety hazard

Manual suspension at admin discretion. Suspended sellers:
- Listings → `removed`
- Open orders → buyer notified, refund initiated, no fee charged
- Payouts paused until resolution

## Children's clothing safety: EN 14682

Norway follows EU EN 14682 — drawstrings/cords on children's upper
clothing 0–7 years are restricted (no drawstrings at hood/neck;
length and exposed-end limits at waist/hem). This is law, not opinion.

We are not a manufacturer or importer, but we run a platform where
sellers list children's garments. Reasonable platform stance:

1. **Disclosure at listing creation.** Checkbox: "Plagget er trygt
   ihht. EN 14682 (ingen snorer/strikker i hals/hette på 0–7 år)."
   For ready-made and commission listings only; pre-loved gets a
   softer "Forsikre deg om at plagget er trygt ihht. EN 14682."
2. **No certification claim.** We're not certifying. The seller is.
3. **Removal on report.** Reports of cord-at-neck listings are
   priority and acted on in 24h.
4. **Help text + link** to Forbrukertilsynet's guidance on cords.

Don't call this a "safety review" — that creates implied liability we
don't want. Frame as "ansvar ligger hos selger."

## Tax & MVA (already covered in 02-payments.md, summary here)

- We are a **marketplace facilitator**, not the seller.
- Knitter declares MVA status at onboarding, self-reported.
- Receipt to buyer reflects seller's MVA status (incl. `org_number`
  if applicable).
- Platform fee is our income; we register for MVA on it once we
  cross 50 000 NOK ourselves (likely fast once volume picks up).
- Surface a "Inntektsoversikt" CSV export in knitter dashboard —
  helps with `selvangivelse` / `næringsoppgave`.

## Terms of service: marketplace clauses to add

Existing ToS (if any) covers pattern PDF sales. We need new clauses
specifically for marketplace. Items to draft (defer wording to a
lawyer; this is the surface):

1. **Role definition.** Platform = facilitator. Sellers are not
   employees, agents, or representatives.
2. **Seller responsibilities.** Authenticity (no counterfeits, no
   reselling other designers' patterns), accuracy (sizes, condition,
   photos match), shipping timeline, EN 14682 compliance.
3. **Buyer responsibilities.** Truthful sizing info, prompt payment,
   reasonable receipt confirmation.
4. **Money handling.** Funds held until release. Auto-release timer.
   No interest paid on held balance.
5. **Refunds & disputes.** Process, response times, admin discretion.
6. **Reviews.** Honest, no incentivized, removed if defamatory.
7. **Fees.** Schedule (refer to in-app fee page, which is updateable).
   30 days notice for fee changes.
8. **Intellectual property.** Sellers grant platform license to display
   their listings; we don't own their photos.
9. **Account suspension.** Triggers + appeal process.
10. **Data & GDPR.** Already in privacy policy; reference here.
11. **Governing law.** Norwegian law, Oslo tingrett venue.

## GDPR & data hygiene

- Right to erasure: sellers can delete account, which:
  - Hard-deletes `knitter_profiles`, `commission_offers`
  - Anonymizes (not deletes) `marketplace_orders` and `reviews` —
    the other party has a legitimate interest in their record
  - Replaces seller name with "Slettet bruker"
- Order messages: kept for 2 years post-release for dispute records,
  then auto-deleted.
- IP addresses: not stored on listings or messages.
- Consent: explicit at signup for marketing email; transactional
  email (order updates) is non-consent (legitimate interest).

## Insurance & liability — when to think about it

Probably **not in v1**. Worth knowing:

- Norway has a `forbrukerkjøpsloven` (consumer purchase law) that
  applies to B2C sales. Most pre-loved sales are C2C (private to
  private), which falls under `kjøpsloven` instead — much weaker
  consumer protection. Distinguish in ToS.
- Once a knitter operates as `enkeltpersonforetak`, they become
  professional and `forbrukerkjøpsloven` applies. They get more
  obligations.
- Platform liability insurance (~10 000 NOK/yr in NO for small
  marketplaces) — defer until clear need.

## What ships in v1 (trust-wise)

- ★ ratings + reviews
- "Verifisert strikker" badge
- Report button on every listing/profile/order
- Suspension capability (admin tool, no fancy UI — direct DB updates
  fine for first 100 cases)
- ToS marketplace clauses
- EN 14682 disclosure on ready-made and commission listings
- "Hva er Marked?" help page covering the basics

What we **don't** build in v1 to keep scope sane:
- Identity verification beyond Stripe Connect KYC
- Buyer protection insurance
- Seller fee tiers based on review score
- Public seller scorecards beyond ★
