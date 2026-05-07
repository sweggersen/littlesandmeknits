# 03 — UX & information architecture

## Where it lives in the studio

The studio bottom tab bar today has five tabs:

```
Hjem · Prosjekter · Garn · Verktøy · Meg
```

The marketplace is a top-level concern, but adding a sixth tab breaks
the comfortable five-tab layout (`StudioTabBar.astro`). Two viable IA
shapes — pick at implementation time:

### Option A — replace `Verktøy` with `Marked`, demote tools
- Tabs: `Hjem · Prosjekter · Garn · Marked · Meg`
- `Verktøy` moves under `Hjem` as a card group, since it's used less
  often than the marketplace will be
- Tightest layout, lowest cognitive load
- **Recommended.**

### Option B — keep five, fold marketplace into `Hjem`
- `/studio` becomes a hub with marketplace at the top
- Loses dedicated tab affordance; marketplace surface harder to find
- Better if we want to A/B before committing

The route stub at `src/pages/studio/marked/index.astro` lays the
groundwork without touching the tab bar — start there.

## URL structure

Norwegian-first slugs to match existing conventions
(`/oppskrifter`, `/studio/garn`, `/studio/pinner`).

```
/marked                                 — public marketplace home
/marked/brukt                           — pre-loved listings
/marked/nytt                            — ready-made listings
/marked/oppdrag                         — open commission requests board
/marked/listing/:id                     — listing detail
/marked/oppdrag/:id                     — request detail
/strikkere                              — knitter directory
/strikkere/:slug                        — public knitter profile

/studio/marked                          — seller hub (my listings, orders)
/studio/marked/listing/ny               — create listing
/studio/marked/listing/:id              — edit own listing
/studio/marked/ordrer                   — orders to fulfill (seller view)
/studio/marked/ordrer/:id               — fulfill order
/studio/marked/oppdrag                  — my offers (knitter)
/studio/marked/payouts                  — payout history
/studio/marked/innstillinger            — knitter settings (Stripe Connect)

/studio/kjop/marked                     — my purchases (buyer view)
/studio/kjop/marked/:id                 — order detail (buyer)
/studio/oppdrag/ny                      — post a commission request
/studio/oppdrag/:id                     — buyer-side request management
/studio/barn                            — child profile manager (sizes)
```

`/marked/*` is **public** (browseable without login). `/studio/marked/*`
is **gated** by the existing `getCurrentUser` middleware. Same split
the app already does for `/oppskrifter` (public) vs `/studio/...`
(gated).

## Three buyer journeys

### Journey 1: Pre-loved scroll-and-buy (lowest friction)
Goal: parent looking for a 92-size cardigan.

1. Land on `/marked/brukt`
2. Filter: size 92, category `cardigan`
3. Tap a listing → `/marked/listing/:id`
4. "Kjøp nå" → checkout (Stripe, NOK)
5. Confirmation page → "Selger sender innen 3 dager"
6. Email + push when shipped, when delivered
7. After delivery: "Bekreft mottatt" → release funds → review prompt

### Journey 2: Ready-made discovery from pattern page (the killer funnel)
Goal: pattern PDF buyer who doesn't want to knit it themselves.

1. On `/oppskrifter/[slug]` (existing pattern page) — add a section:
   "Vil du at noen skal strikke den for deg?"
2. CTA shows 3–5 active ready-made listings of *this* pattern, plus
   "Bestill ferdigstrikket" → opens commission request prefilled
3. Pre-filled fields: pattern slug, suggested yarn list, buyer's
   saved child size from `child_profiles`
4. Buyer adjusts colorway, size, budget → posts → request goes live
   on `/marked/oppdrag`

This is the funnel no other Norwegian marketplace can replicate. Treat
it as a feature flag-able experiment in Phase 4 — Phase 1–3 don't
require pattern-page integration.

### Journey 3: Targeted commission via knitter profile
Goal: buyer found a knitter they like.

1. `/strikkere/:slug` shows knitter's portfolio (carried over from
   their public projects), specialties, turnaround, reviews
2. "Be om tilbud" → form with pattern (Sam's library + freetext fallback),
   size, budget, deadline
3. Goes only to that knitter as a `commission_requests` row with
   `visibility: 'private'` (a future column — flag for v2)
4. Knitter accepts/declines/counters

## Three seller journeys

### Journey 1: First-time pre-loved listing (lowest barrier)
Goal: parent emptying the closet.

1. From `/studio` → "Selg det du har strikket" CTA
2. `/studio/marked/listing/ny`
3. Form: photos, title, size, condition, price, shipping
4. Skip Stripe Connect for now? **No** — funds need a destination.
   Onboard knitter to Stripe Connect *before* first listing publishes
   (block at "Publish"). Drafts can be saved without onboarding.
5. After Connect: listing goes live
6. Order arrives → notification, "Send innen 3 dager" guidance
7. Mark shipped (paste tracking) → buyer confirms → release → payout

### Journey 2: Knitter accepts a commission request
1. `/marked/oppdrag` → filter open requests (size, pattern, budget)
2. Tap request → "Send tilbud" form (price, weeks, message)
3. If accepted → buyer pays → order goes to `in_progress`
4. Knitter posts updates in order chat (photos of WIP welcome)
5. Mark shipped → confirm → release

### Journey 3: Knitter dashboard
`/studio/marked` for sellers shows:
- Active listings (count, views, watchers)
- Orders to fulfill (CTA: "Send i dag")
- Open offers awaiting response
- Recent reviews
- Available payout balance + next payout date

## Trust UI — what's visible and where

- **Knitter card** in directories: avatar, name, ★4.8 (32 reviews),
  specialties chips, "Ledig om 2 uker", verified-badge if Stripe
  charges_enabled
- **Listing card**: hero photo, price, size, condition (pre-loved
  only), seller name + ★, "Sendes fra Oslo"
- **Pattern page funnel cards**: "Strikket av [Knitter] · ★4.9"
- **Order timeline**: "Bestilt → Betalt → Sendt → Levert →
  Bekreftet" — visible to both sides

## Mobile-first details that matter

- Listing photos: square aspect, swipeable, lazy-loaded — match
  existing project photo carousel (`html-to-image` already in deps
  but probably not relevant here; reuse existing photo gallery
  components from `/studio/prosjekter`).
- Sticky "Kjøp nå" / "Be om tilbud" CTA on listing detail.
- Saved searches (size 92, cardigan, < 500 NOK) → push notifications
  when matches appear. Push infra exists in repo (`PushNotification`
  tool name suggests web push setup).
- Chat: in-app only for v1; no SMS/email-relay (privacy + spam).

## Empty-state strategy

- `/marked/brukt` empty: "Ingen brukte plagg akkurat nå. Bli varslet
  når det kommer noe" → email/push subscribe
- `/marked/oppdrag` empty: "Ingen åpne forespørsler. [Knitter?] Legg
  ut din profil og bli funnet"
- Empty knitter dashboard: walkthrough card showing the "list one
  thing" path

## Forms — what to actually ask

Listing creation (don't over-ask, this is the conversion bottleneck):
- Photos (1–5)
- Title
- Category (dropdown)
- Size (label + optional age range)
- Pre-loved? (toggles condition + accepts older listings)
- Pattern (Sam's library autocomplete + freetext fallback, optional)
- Yarn (autocomplete from existing `yarns`, optional)
- Color (freetext)
- Price NOK
- Description (markdown, optional)
- Shipping (preset options: Posten Småpakke, Posten Servicepakke,
  henting i Oslo)

That's it. No "weight in grams," no "fiber composition" required —
those go in description if relevant.

## Norwegian copy tone

Match the rest of the app — warm, direct, second-person singular.
Existing patterns: "Mine oppskrifter," "Pinner du har lagt til,"
"Velkommen, [name]." Don't switch to formal "De/Dem" or
business-y "Vår plattform" — keep it personal.

Specific copy choices:
- "Marked" not "Markedsplass" (shorter, friendlier)
- "Strikker" for the seller side ("knitter") — matches existing
  designer/community voice
- "Brukt" not "secondhand" — it's the natural NO word
- "Bestill ferdigstrikket" for the commission CTA on pattern pages
- "Bekreft mottatt" for buyer release
