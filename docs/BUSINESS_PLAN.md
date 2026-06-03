# Littles and Me Knits — Business plan & roadmap

> Last updated: 2026-06-03. Living doc. The earlier
> `docs/marketplace/*` files describe the *original* MVP plan from
> exploration days. This file is the current ground truth.
>
> **Launch execution plan lives in [`june26.md`](../june26.md)** — that file
> has the prioritized P0/P1/P2 work, go/no-go gates, and the risk register.
> §3.2 below is the feature *inventory* (status), not the work plan; the two
> were reconciled on 2026-06-03 (several May "must-haves" had already shipped).

---

## 1. Where we stand

Littles and Me Knits has graduated from "knitting designer's site" into a
three-section product with a working marketplace, a personal studio, and
a pattern shop — all under one roof, Norwegian-first.

### 1.1 The three sections

| | Surface | Core jobs |
|---|---|---|
| **Littles and Me Knits** | `littlesandmeknits.com` (and **strikketorget.no** for the marketplace) | Brand home, pattern shop, projects gallery, "om oss" |
| **Strikketorget** | `/market` (also bare `strikketorget.no/`) | Marketplace: brukt, nytt, strikk for meg, butikker |
| **Strikkestua** | `/studio` | Personal knitting studio: projects, yarn stash, needles, library |

### 1.2 What's actually live (May 2026)

#### Marketplace — Strikketorget
- **Three transaction shapes** (Brukt, Nytt, Strikk for meg) + verified business **Butikker** (Tier-2 orgnr verification).
- **Stripe Connect** with destination charges + manual capture → escrow on every escrow-opted purchase. 14-day auto-release cron.
- **Shipping**: Bring/Posten integration, buyer address collection at checkout, tracking-code field on the seller side, delivery confirmation.
- **Listings**: 9 statuses (draft → pending_review → active → reserved → shipped → sold; plus frozen / rejected / removed). Multi-photo gallery. Promotion tiers (paid boost). Favorites + favorite_count signal.
- **Stores**: orgnr-verified businesses, multi-member roles (owner / admin / manager / contributor), public storefronts with logo/banner, image moderation, Stripe Connect onboarding per store, subscription tier (starter trialing → pro paid).
- **Commissions ("Strikk for meg")**: request → offers → award → optional yarn-provided-by-buyer flow → in-progress → completed → delivered. Escrow + auto-release. Project tracking via studio integration.
- **Reviews**: per-listing seller reviews + commission transaction reviews. Aggregated avg surfaces on seller / listing / store cards.
- **Reports + moderation**:
  - Per-target grouped reports (one row per item, not per report).
  - Two-step decide-and-freeze: valid → freeze item + open in-app moderator thread with required outreach; not valid → dismiss.
  - Frozen items hidden from public; owners see "Viktig — moderator" amber inbox row.
  - 48h auto-close cron if owner doesn't reply.
  - Shadow-review training period (50 reviews) + senior moderator confirmation, plus admin spot-checks.
  - Anonymous report opt-out with disabled "contact reporter" for mods.
- **Disputes**: separate moderator interface mirroring reports, attached to listings/commissions with Stripe refund integration.
- **Inbox (`/inbox`)**: unified feed of marketplace conversations + moderation threads + notifications, with read-on-click + smart timestamps. Bell badge counts unread across all three.
- **Recommendations**: home shows "Anbefalinger for deg" (logged-in, derived from favorited categories) or "Populære annonser" (anonymous, by favorite_count). Paid promotions interleaved every 4th slot.
- **Trust score**: per-user computed from delivery rate, review averages, dispute history. Recalc cron. Surfaced as green/amber/orange/red pill on seller cards.
- **Achievements** system (first sale, first 5★, etc).

#### Studio — Strikkestua
- Projects (status, progress logs, hero photos)
- Yarn stash + needles inventory
- Pattern library (purchased patterns auto-added)
- Integration with commission flow (knitter logs project → buyer sees updates)

#### Pattern shop
- Stripe one-shot checkout
- PDF delivery via signed Supabase storage URLs
- Per-buyer library

#### Cross-cutting infrastructure
- Astro 6 SSR + Cloudflare Workers + Supabase (auth + DB + storage). Local dev via OrbStack + Supabase CLI.
- Email via Resend, web push via VAPID, mobile PWA install prompt.
- 80 SQL migrations, RLS on every table.
- ~500 tests: Vitest unit + service-layer fakes, a 99% mutation-score gate over the money-critical functions (`npm run test:mutation`), and real-local-Postgres integration tests including a Stripe-signed webhook→DB round trip. Playwright e2e specs across the main flows.
- Three deploys per day during active dev. `wrangler deploy` from local; GitHub auto-deploy not yet hooked up (see june26.md §1.3).

### 1.3 Numbers (current, dev DB seed)

Dummy seed in local DB: 20 users · 13 stores · 300 listings · 24 conversations · 18 reports · 3 active moderator threads · 842 storage objects.

Cloud DB: wiped, schema-only. Zero real users.

---

## 2. Strategy

### 2.1 Wedge

Strikketorget is **the Norwegian marketplace for handmade kids' knitwear**. The wedge is **pre-loved** — parents whose kids outgrew an heirloom-quality handmade item in 6 months, who currently throw it away or shove it in a drawer. Highest emotional resonance, lowest transaction friction, recurring liquidity.

From there we expand:
1. **Ferdigstrikket** — knitters who'd otherwise sell on Facebook groups now have a real storefront.
2. **Strikk for meg** — buyers who want a specific item commissioned, with project tracking, escrow, and the pattern catalog as a starting menu.
3. **Butikker** — registered businesses can run multi-member shops.
4. **Pattern marketplace** (future) — UGC knitter-uploaded patterns with revenue share, leveraging the studio's project log as social proof.

### 2.2 Why we win

| Competitor | Why they fall short |
|---|---|
| **Finn.no** | No buyer protection, no escrow, no fitting/sizing guidance. Treats handmade as generic used goods. |
| **Etsy** | Foreign, English-speaking, USD-leaning. No Vipps. No NO tax compliance for buyers. |
| **Facebook groups (e.g. "Strikkebørs")** | Chaotic, no payment integration, scam-prone, untracked. We can siphon by being the safer/cleaner alternative. |
| **Instagram DMs** | Same as above — fine for discovery, terrible for transaction. |

Our moat:
- **Norwegian-first**: nb language, Vipps + Stripe Connect, NO tax handling (planned), orgnr verification.
- **Made for handmade**: sizing/age categories specific to baby knitwear, "Pre-loved" framing instead of "Used", project-log social proof.
- **Trust by default**: escrow on every transaction with `escrow_enabled`, two-step moderation, transparent dispute resolution.
- **Pattern catalog** is the gravitational center; "browse a pattern → order it commissioned" is a flow nobody else can build.

### 2.3 Monetization

Four revenue streams:

| Stream | Rate | Notes |
|---|---|---|
| **Brukt** | Flat 10 NOK under 500 NOK; 5% over | Volume play |
| **Nytt** | 8% transaction fee | Mid-tier |
| **Strikk for meg** | 12% transaction fee | Highest service load (escrow, project tracking, support) |
| **Promoted listings** | 49 / 99 / 199 NOK for 7/14/30 days | Paid boost (currently wired, three tiers) |
| **Store subscriptions** | Starter (free trial) → Pro (TBD ~99 NOK/mo) | Unlocks multi-member, custom accent color, analytics. Currently trialing→pro pipeline in Stripe Subscriptions. |
| **Pattern shop** | 100% of designer-owned patterns (existing). 80/20 split planned for UGC patterns. | |

### 2.4 Stage gates

- **Now (private beta)**: 50 invited users testing brukt + commission flow.
- **Soft launch (Q3 2026)**: open registration, only brukt + nytt. Stores invite-only.
- **Public launch (Q4 2026)**: all four pillars open. Tax compliance done. First marketing push.
- **Year 2**: pattern UGC marketplace, mobile app, Sweden expansion.

---

## 3. Comprehensive feature inventory

### 3.1 Shipped (✅) — what's already in production

#### Auth + accounts
- ✅ Supabase Auth (email + magic link), profile rows with display_name, location, role, avatar
- ✅ Dev login (localhost-only) for instant role-switching
- ✅ Section-session cookie (`st_session`) so profile/inbox pages stay in the Strikketorget shell

#### Browse + discovery
- ✅ Strikketorget home with personalized "Anbefalinger for deg" / "Populære annonser"
- ✅ Brukt / Nytt / Butikker / Strikk for meg subpages
- ✅ Category + price + size filters, full-text search
- ✅ Favorites + showFav toggle on cards
- ✅ Promoted listings interleaved into feeds
- ✅ Listing detail with photo gallery (1–5 photos, click-through arrows)

#### Listing creation + lifecycle
- ✅ Multi-photo upload with reorder + delete
- ✅ Hero auto-derived from first photo
- ✅ Draft → pending_review → moderator approval → active
- ✅ Reserved → shipped → delivered → sold (escrow)
- ✅ Rejected listings refund the listing fee
- ✅ Frozen state with `pre_freeze_status` restore

#### Payments
- ✅ Stripe Connect (Norway) destination charges
- ✅ Manual capture for escrow on listing purchase
- ✅ Auto-capture 14 days after delivery (cron)
- ✅ Buyer shipping address collected at Checkout, stored on listing
- ✅ Refund on rejection / dispute resolution
- ✅ Stripe Subscriptions for store pro tier (trialing → active)
- ✅ Listing fee, payout flow

#### Stores (Butikker)
- ✅ orgnr verification against Brønnøysundregistrene
- ✅ Multi-member roles with permission predicates
- ✅ Public storefront with logo, banner, location, verified badge
- ✅ Per-member visibility on storefront
- ✅ Suspended state with moderator thread integration
- ✅ Image moderation (logo + banner) before publish

#### Commissions ("Strikk for meg")
- ✅ Request creation with budget, size, category, deadline
- ✅ Knitter offers with price + turnaround
- ✅ Yarn-provided-by-buyer optional flow with shipping tracking
- ✅ Award → in-progress → completed → delivered
- ✅ Project log integration (knitter posts updates, buyer sees them in commission view)
- ✅ Escrow auto-release at delivery + 14 days

#### Messaging + notifications
- ✅ Per-listing buyer↔seller conversations
- ✅ Per-commission buyer↔knitter conversations
- ✅ Moderator threads (with backdrop + email + push)
- ✅ Unified `/inbox` (messages + mod threads + notifications)
- ✅ Bell badge counts unread across the three streams
- ✅ Email via Resend (templated per notification type)
- ✅ Web push via VAPID
- ✅ Per-type email preferences

#### Trust + safety
- ✅ Reports grouped per target (listing/store/commission) with bulk resolve
- ✅ Two-step freeze → mod thread → close+restore-or-keep-frozen
- ✅ Anonymous report opt-in
- ✅ Mod thread auto-close after 48h of no recipient reply
- ✅ Shadow review training period + senior moderator confirmation
- ✅ Admin spot checks
- ✅ Dispute resolution with Stripe refund integration
- ✅ Per-user trust score (delivery + review + dispute factors)
- ✅ Achievements (first sale, etc.)

#### Reviews
- ✅ Seller reviews (per listing or store)
- ✅ Commission transaction reviews (both buyer + knitter rate each other, hidden until both submit or deadline)
- ✅ Star aggregation on profile + storefront + listing detail
- ✅ Trust-score recompute on review insert

#### UX
- ✅ Strikketorget section takeover: own nav + footer + section session
- ✅ Persistent nav across view transitions (no logo flash)
- ✅ Mobile hamburger with backdrop + ESC + body-scroll lock
- ✅ Mobile back chevron on detail pages
- ✅ Responsive home (compact mobile, two-column desktop hero)
- ✅ Listing photo gallery with click-to-zoom lightbox
- ✅ View Transitions for snappy SPA-feel

#### Dev tooling
- ✅ Local Supabase via OrbStack (`scripts/dev-up.sh`)
- ✅ Prod → local data snapshot for debugging (`scripts/snapshot-prod.sh`)
- ✅ Cloud storage orphan cleanup (`scripts/cloud-storage-clean.sh`)
- ✅ Big seed script (`scripts/seed-big.ts`) — 300 listings + photos
- ✅ Test Control Tower for end-to-end scenario runs
- ✅ Dev menu (localhost) with admin shortcuts
- ✅ AppleDouble file stripper in build step

---

### 3.2 Pre-launch must-haves — reconciled 2026-06-03

> Status legend: ✅ shipped · ◐ partial · 🔴 real gap. Many May "must-haves"
> had already shipped by June. The **work plan** (with priorities, gates, and
> the items this inventory understated) is [`june26.md`](../june26.md);
> cross-references below point to its sections.

#### Legal + compliance
- ◐ **Personvern (Privacy)** page — real Norwegian content exists at `/privacy`. **Gate is lawyer review** against the actual escrow/fee/data-processing flows, not existence (june26 §1.1).
- ◐ **Vilkår (Terms)** page — real content at `/terms`; same lawyer-review gate.
- 🔴 **MVA (Norwegian VAT)** — still the launch gate, and bigger than first scoped: destination charges make the platform merchant-of-record (deemed-supplier VAT risk on C2C). Needs accountant + possible charge-model change (june26 §1.1).
- ✅ **Bokføring export** — `/api/profile/bookkeeping`.
- ✅ **GDPR data export + right-to-be-forgotten** — `/profile/data` + `exportPersonalData`/`deleteAccount`.
- ◐ **Aldersgrense (13+)** — `age_confirmed_at` + `/onboarding/birthday`; surface in terms/signup copy.
- ✅ **Cookie banner** + policy — `CookieBanner.astro`, wired in `Layout`.

#### Onboarding
- 🔴 **Seller onboarding wizard** — still a bare Stripe Connect wall; biggest supply-side friction (june26 §1.5).
- 🔴 **First-listing template** — part of the wizard work.
- ◐ **Phone / SMS verification** — Vipps OIDC already returns a verified phone; surface it, decide if non-Vipps signups need an SMS step.
- 🔴 **Welcome email** sequence + deliverability (SPF/DKIM/DMARC) (june26 §1.6).

#### Payments
- ✅ **Vipps** — login (OIDC) live + Vipps as a Stripe Checkout method.
- ✅ **Receipts** — NO-format `kvittering` pages (listings + commissions). VAT line lands with §1.1.
- 🔴 **Money-flow failure handling** (NEW, was missing entirely) — webhook ignores chargebacks / payout failures / failed captures; auto-release silently drops failed captures (june26 §1.2). **Highest-risk gap.**
- 🟡 **Klarna installments** — post-launch, commissions only.
- 🟡 **Refund polish** — partial refunds + reason picker (june26 §2.3).

#### Support
- ✅ **Help center / FAQ** — `/hjelp` + `kjope` / `selge` / `trygg-betaling`.
- ◐ **Contact form / support inbox** — currently `mailto:`; route into a moderator thread (june26 §2.3).
- 🔴 **Error reporting** (Sentry) (june26 §1.7).
- 🔴 **Performance monitoring** (Web Vitals + RUM) + privacy-respecting product analytics (june26 §1.7).

#### Operational
- 🔴 **GitHub auto-deploy** + **reliable migration delivery** — manual paste is proven-fragile (0038 partial, 0077 anon-browse incident); move to CI `db push` + schema-drift gate (june26 §1.3).
- 🔴 **Incident response** (NEW) — no payments kill-switch, no rollback runbook, no feature flags (june26 §1.4).
- 🔴 **Database backups** schedule + restore drill (Supabase Pro).
- 🔴 **Staging environment** for E2E before each release (june26 §1.3).
- ◐ **Admin observability** — `/admin` shows pending/reports/disputes counts; needs revenue/volume/signup trends (june26 §2.3).
- 🔴 **Accessibility (WCAG AA) pass** (NEW) (june26 §2.2).

---

### 3.3 Polish + post-launch (🟡 → within 60 days of launch)

#### Marketplace
- 🟡 **Saved searches with alerts** — "notify me when a new Marius-genser str 4 år shows up"
- 🟡 **Wishlist beyond single-favorite** — multiple named lists
- 🟡 **Listing variants** — size + color as a single listing with variants
- 🟡 **Stock alerts** — "in stock again" for items that came back
- 🟡 **Bulk listing import** for stores — CSV upload with photos in a zip
- 🟡 **Listing scheduling** — "publish in 3 days when I get back from cabin"
- 🟡 **Drafts → autosave**

#### Commission flow
- 🟡 **Milestone payments** — split commission into 25/50/25 (escrow per milestone)
- 🟡 **Yarn ordering integration** — auto-link to a yarn retailer for the chosen pattern
- 🟡 **Photo update prompts** — bot nudges knitter every 5 days during in-progress
- 🟡 **Pattern + size auto-suggest** based on past requests

#### Stores
- 🟡 **Store analytics dashboard** — views, conversion, top sellers, refund rate
- 🟡 **Custom store slug** changes (currently set once at creation)
- 🟡 **Store collections / curated bundles** — "matching hat + mittens set"
- 🟡 **Vacation mode** — auto-pause listings during a break
- 🟡 **Store-level promotion budget** with auto-pause when spent

#### Discovery + retention
- 🟡 **Weekly digest email** — new listings in your saved categories
- 🟡 **Recommendation tuning** — also use viewed (not just favorited) items as signal; "people who favorited this also liked"
- 🟡 **Referral program** — invite a friend, both get 10 NOK off first purchase
- 🟡 **SEO** — sitemap.xml, structured data on listings, OG images
- 🟡 **Social share images** — autogen "Pre-loved Marius — 280 kr" cards for IG sharing
- 🟡 **Public seller profiles** with portfolio shots

#### Trust + safety
- 🟡 **Refund / return policy per listing** — sellers opt into "returns accepted within X days"
- 🟡 **KYC for high-volume sellers** — escalate verification when monthly volume crosses threshold
- 🟡 **Fraud detection signals** — velocity caps, IP / device hash heuristics
- 🟡 **Buyer / seller block list**
- 🟡 **Moderator workload balancing** — auto-assign next item, queue priority

#### Studio
- 🟡 **Public profile pages** — "Sam's projects" shareable
- 🟡 **Project-based pattern progress** with row counters
- 🟡 **Pattern bundles** in shop
- 🟡 **Pattern + yarn kits**

---

### 3.4 Speculative / Year 2 (🟢 → exploratory)

- 🟢 **UGC pattern marketplace** — designers upload their own patterns, 80/20 revenue share, automatic library/library push
- 🟢 **Native mobile apps** (iOS + Android) — start as PWA wrapper, evolve
- 🟢 **Sweden expansion** — sek currency, swedish translation, klarna already covered
- 🟢 **Auction format** — for rare vintage handmades
- 🟢 **Loyalty program** — points per delivery, redeem against fees
- 🟢 **Affiliate links to yarn retailers** — kickback per click-through
- 🟢 **Real-time chat with attachments** — currently text-only
- 🟢 **Voice messages** in commission threads
- 🟢 **In-app AR sizing** — "hold phone next to your baby"
- 🟢 **AI-generated product descriptions** — seller uploads 3 photos, we draft the listing copy

---

## 4. Roadmap

### 4.1 Next 30 days (June 2026) — launch readiness

The May week-by-week plan is superseded: most of its legal/payments/onboarding
deliverables already shipped (see §3.2). The current, reconciled June plan —
with go/no-go gates and the higher-risk gaps it surfaced (money-flow failure
handling, migration delivery, payments kill-switch) — is **[`june26.md`](../june26.md)**.
Headline P0s: VAT/merchant-of-record, payments failure-mode hardening, reliable
migration delivery + CI, incident kill-switch, seller onboarding wizard.

### 4.2 60 days (July–August) — soft launch

| Theme | Deliverables |
|---|---|
| Buyer retention | Saved searches + alerts. Weekly digest. Listing variants. Bulk store import. |
| Commission flow | Milestone payments. Photo update nudges. Yarn integration MVP. |
| Marketing | SEO + sitemap. Social share cards. Referral program. Public seller profiles. |
| Trust | KYC escalation. Velocity-based fraud signals. Per-listing return policy. |

### 4.3 90 days (Sept–Oct) — public launch

- All four pillars open registration
- Press / influencer outreach with seeded stories
- Paid promotion campaign (Instagram + Meta)
- Customer service SLA: <24h email response

### 4.4 Year 2 themes

- UGC pattern marketplace
- Sweden expansion
- Native mobile

---

## 5. Risks + technical debt

### 5.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Norwegian VAT compliance gaps catch us mid-launch | Medium | High | Accountant review pre-launch. Pause launch if Skatteetaten reporting isn't right. |
| Stripe Connect rejects a Norwegian SMB seller | Medium | Medium | Document fallback to bank-transfer-only listings while Stripe escalation runs. |
| Marketplace liquidity stalls (no listings → no buyers → no listings) | High | High | Seed with hand-curated 50 listings via direct seller outreach before opening. |
| Knitter Facebook groups don't migrate | Medium | High | Embed in their community first (sponsor knitter meetups, invite their admins to a private beta). |
| Disputes overwhelm a 2-moderator team | Medium | Medium | Auto-escalation threshold + Stripe Disputes pipeline. Plan moderator hiring at 100 weekly transactions. |
| Cloudflare Workers cold-start latency | Low | Low | Free tier; upgrade when needed. Monitor Web Vitals. |
| Supabase free-tier limits | High (will hit) | Medium | Audit usage. Pro tier ~$25/mo planned for soft-launch. |

### 5.2 Technical debt

- **No GitHub auto-deploy + fragile migration delivery.** Every deploy is `wrangler deploy` from a laptop and migrations are pasted into the dashboard (non-transactional). This has already bitten us — `0038` applied only partially to prod and `0077` broke anon browsing. Move to CI `supabase db push` + a `db diff` schema-drift gate (june26 §1.3).
- **No staging environment.** We test against local Supabase + Cloudflare prod. Need an isolated staging.
- **Legal pages** (`/privacy`, `/terms`) now have real Norwegian content but are **not lawyer-reviewed**; `/om` is still a 9-line stub. Review is the gate (june26 §1.1).
- **Test coverage** — substantially improved: ~500 tests, service-layer fakes, a 99% mutation-score gate over the money paths, and real-Postgres integration incl. a signed Stripe webhook→DB round trip. Remaining gap: the *failure-mode* paths (chargeback/payout-failure) aren't handled yet, so they aren't tested either (june26 §1.2).
- **No Sentry / error tracking.** Cloudflare observability is on but not integrated with alerts (june26 §1.7).
- **`gitignore` polish**: `node_modules/.vite` survives between builds and occasionally needs manual clearing (`scripts/dev-up.sh` could do this).
- **`._*` AppleDouble files** keep regenerating on the T5 external drive — build strips them but they live in source tree too. Consider moving the working copy off exFAT.
- **Two cloud DBs in one project** — the wipe earlier could be cleaner if we had a separate staging Supabase project. Pro tier unlocks branching.
- **Recommendation algorithm** is rudimentary (favorites→categories). View/impression tracking now exists (`track/impression`) but recs don't use it yet — wire the signal in (june26 §3).

---

## 6. Open questions

1. **Vipps or Klarna first?** Vipps is more familiar; Klarna unlocks bigger basket sizes. Probably Vipps for brukt + nytt, Klarna for commissions only.
2. **Do we let buyers post Strikk-for-meg requests without verifying yarn knowledge?** Bad requests waste knitter time. Maybe a one-time interactive guide before first request.
3. **Knitter-uploaded patterns: when?** Tempting to launch UGC patterns alongside the marketplace; pulling it forward could be a discovery hack. Risk: copyright. Defer to Year 2.
4. **Pricing for stores Pro tier.** Right now Starter is trialing → Pro is theoretical. Validate with 5 paying stores in the beta before publishing the price.
5. **Sam's role post-launch.** Founder/CEO + designer + moderator is unsustainable past 100 active sellers. When do we hire the first community manager?

---

## 7. Where this lives + how to update

- This file is the canonical product strategy. PRs that touch business logic should update it in the same diff.
- `.claude/agents.md` covers dev environment + scripts.
- `docs/STORES.md` covers the stores subsystem in depth.
- `docs/marketplace/*` is the **original exploration** — pre-launch planning material. Don't update it; reference it for historical context only.
