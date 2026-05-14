# Marketplace Readiness Report

**Date:** 2026-05-13
**Scope:** Gap analysis vs. Finn.no, Tise, Etsy, and Ravelry

---

## What We Have (strong foundation)

| Area | Status | Notes |
|------|--------|-------|
| Listings (pre-loved + ready-made) | Done | Full CRUD, photos (6 max), 29 NOK listing fee, draft→publish |
| Commission system | Done | Full state machine: open→offer→pay→yarn→complete→deliver |
| Stripe Connect payments | Done | Escrow via manual capture, 13%/8% platform fee, Connect payouts |
| Messaging | Done | Per-listing and per-commission conversations, unread tracking |
| Trust scoring | Done | 9-factor algorithm, 3 tiers (new/established/trusted), auto-approve |
| Moderation | Done | Queue, shadow reviews, spot checks, audit log, admin dashboard |
| Reviews | Done | Bidirectional post-delivery reviews, trust recalculation |
| Reports | Done | User-filed reports with moderator resolution |
| Notifications | Done | In-app + email (Resend) + web push (VAPID) |
| Seller profiles | Done | Bio, tags, avatar, listings, reviews, instagram |
| Bring shipping | Done | Booking + tracking for buyer-provided yarn |
| Norwegian + English | Done | Full i18n with cookie-based language preference |
| RLS security | Done | Row-level security on all tables, pinned sensitive columns |
| CI + tests | Done | 32 unit tests, CI pipeline, smoke test harness |

---

## Critical Gaps (must fix before opening)

### 1. No buyer protection / dispute resolution

**Gap:** If a knitter never delivers, or the buyer claims the item is wrong, there is no process. Payment auto-releases after 14 days (`auto_release_at`) but the cron job to enforce it doesn't exist.

**Why it matters:** Finn's "Fiks ferdig" and Tise both have formal buyer protection. Norwegian consumers now expect this as baseline. Without it, buyers won't trust the platform with 800-1500 NOK commission payments.

**What to build:**
- Implement the 14-day auto-release cron (capture payment if buyer doesn't respond)
- Add a "dispute" action before auto-release: buyer can flag a problem
- Disputed items: freeze payment, notify admin, require manual resolution
- Display buyer protection messaging on checkout pages ("Pengene holdes trygt til du bekrefter mottak")
- Write a simple policy page explaining the protection

**Effort:** Medium (2-3 days). The escrow infrastructure is already there — we hold payment via manual capture and release on `confirmDelivery`. The gap is the dispute path and the auto-release background job.

---

### 2. No search — only category browse

**Gap:** Users can filter by category and age range, but cannot search by text. No price range filter. 60 listings hard limit with no pagination.

**Why it matters:** Every competitor has search. Even Ravelry (a community site) has powerful search. Without it, users with more than a few dozen listings will find nothing.

**What to build:**
- Full-text search on listing title + description (Supabase `tsvector` or `ilike`)
- Price range filter (min/max NOK)
- Size/age filter on all browse pages (already on brukt, missing on nytt)
- Pagination or infinite scroll (currently capped at 60)
- Sort options: newest, price low→high, price high→low

**Effort:** Medium (2 days). Supabase supports `to_tsvector` natively. Add a GIN index on listings, expose query params on browse pages.

---

### 3. No favorites / wishlist

**Gap:** Users cannot save listings or commission requests for later. No "heart" button anywhere.

**Why it matters:** Favorites are table stakes on Finn, Tise, and Etsy. They drive return visits and purchase intent. Without them, users browse once and forget.

**What to build:**
- `favorites` table: `user_id`, `item_type` (listing | commission_request), `item_id`
- Heart toggle on listing cards and detail pages
- "Mine favoritter" page under profile
- Favorite count on listings (social proof)

**Effort:** Small (1 day). Simple table + RLS + a few UI toggles.

---

### 4. Shipping for finished items is manual

**Gap:** Bring integration exists for buyer-provided yarn, but when a knitter ships the finished item back to the buyer, there's no shipping support. The commission just goes to "completed" and the buyer confirms delivery — but how the physical item gets there is undefined.

**Why it matters:** Finn and Tise both offer integrated shipping label generation. Users expect at least a tracking number. For pre-loved listings, shipping is entirely unaddressed.

**What to build:**
- Extend Bring booking to commission delivery (knitter→buyer) and listing sales (seller→buyer)
- Or: simple tracking number field on mark-completed (knitter enters Posten tracking manually)
- Display tracking info on the commission/listing detail page
- For listings: add a "shipping method" field (meet locally, Posten, Helthjem)

**Effort:** Medium for manual tracking (1 day), Large for full Bring integration on all flows (1 week).

**Recommendation:** Launch with manual tracking number entry. Integrate Bring fully in v2.

---

### 5. No listing purchase flow (pre-loved / ready-made)

**Gap:** Listings exist and can be published, but there's no buy button or checkout for physical items. The only purchase flow is for PDF patterns. The 29 NOK listing fee is the seller paying to list — there's no buyer payment for the actual item.

**Why it matters:** Without a way to pay for listings through the platform, buyers and sellers will exchange money via Vipps outside the platform. This means: no buyer protection, no platform revenue on sales, no transaction data.

**What to build:**
- "Kjøp nå" (Buy Now) button on active listings
- Payment intent via Stripe (same escrow pattern as commissions)
- Seller receives payment minus platform fee after buyer confirms
- Integrate with shipping (tracking required before release)
- Consider Vipps as payment method (most Norwegian users prefer it)

**Effort:** Large (3-5 days). The Stripe Connect infrastructure exists, but the listing purchase flow needs a new state machine (active→sold→shipped→delivered).

---

### 6. Commission request expiration is not enforced

**Gap:** `expires_at` is set to 30 days on creation but nothing happens when it passes. Open requests with zero offers stay visible forever.

**What to build:**
- Cron job: mark expired requests, notify buyer, decline pending offers
- Display "utloper om X dager" on request cards
- Allow buyer to extend expiration

**Effort:** Small (half day). Add to existing `api/cron/run.ts`.

---

## Important Gaps (should fix soon after launch)

### 7. No "follow seller" or social features

Tise's growth was driven by following and social feeds. We don't need the full social model, but "follow this knitter" with notifications on new listings would drive retention. Low effort, high value.

### 8. No seller onboarding guide

New sellers land on the marketplace with no guidance. Etsy and Tise both have step-by-step onboarding: set up profile → connect payments → create first listing. We have all the pieces but no guided flow.

### 9. No SEO / sharing meta tags on listings

Listing detail pages likely lack `og:image`, `og:title`, `og:description` meta tags. Sharing a listing on Facebook or iMessage should show a rich preview. This is free traffic.

### 10. No image optimization

Photos are stored as-is in Supabase Storage (up to 10 MB each). No thumbnails, no WebP conversion, no srcset. Page load with 6 full-res photos will be slow on mobile. Use Cloudflare Image Resizing or generate thumbnails on upload.

### 11. No Vipps integration

Vipps is the dominant payment method in Norway. Stripe supports Vipps as a payment method — enabling it would reduce checkout friction significantly. This is not blocking for launch but will materially affect conversion.

---

## What We Don't Need Yet

| Feature | Why not yet |
|---------|-------------|
| Native mobile app | Responsive web is fine for launch. Tise started web-only too. |
| Promoted listings / ads | Need volume first. |
| Seller analytics | Nice, but no seller has enough data yet. |
| AI recommendations | Need transaction data to train on. |
| Rewards / points | Engagement optimization is a v2 problem. |
| Knitting-specific metadata (gauge, yarn weight) | Great differentiator but not blocking. Projects already track yarn. |

---

## Recommended Launch Sequence

### Phase 1: Minimum viable marketplace (1-2 weeks)

| # | Task | Effort | Why first |
|---|------|--------|-----------|
| 1 | Listing purchase flow (buy button + Stripe escrow) | 3-5 days | No marketplace without transactions |
| 2 | Buyer protection + dispute flow | 2-3 days | Trust is everything |
| 3 | Search + price filter + pagination | 2 days | Discovery beyond 60 items |
| 4 | Favorites | 1 day | Return visit driver |
| 5 | Manual tracking number on delivery | 1 day | Shipping accountability |
| 6 | Request expiration cron | 0.5 day | Cleanup stale data |

### Phase 2: Polish for retention (weeks 3-4)

| # | Task | Effort |
|---|------|--------|
| 7 | Seller onboarding flow | 1-2 days |
| 8 | OG meta tags on all listing/commission pages | 0.5 day |
| 9 | Image thumbnails (Cloudflare Image Resizing) | 1 day |
| 10 | Follow seller + notifications | 1-2 days |
| 11 | Vipps via Stripe | 1 day |

### Phase 3: Growth (month 2+)

- Knitting-specific search (yarn type, needle size)
- Seller analytics dashboard
- Full Bring shipping integration on all flows
- Pattern + finished item bundles
- PWA / app-like experience

---

## Summary

The backend is solid — service layer, escrow payments, moderation, trust scoring, and security are all production-grade. The main gap is on the **buyer side of physical item transactions**: there's no way to actually buy a listing through the platform, no buyer protection policy, and no search. These three things are what separate "a project" from "a marketplace." Phase 1 closes that gap.
