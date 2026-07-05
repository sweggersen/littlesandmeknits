# Adversarial Security Review — July 2026

A malicious-perspective review of Strikketorget (Astro 6 SSR on Cloudflare
Workers, Supabase Postgres + RLS + Auth, Stripe Connect). Four attack surfaces
were swept in parallel — auth/authz, payments/money-integrity, injection/input,
and infra/DoS/secrets — each required to produce `file:line` evidence and a
concrete exploit path, then every confirmed finding was re-traced by hand before
fixing.

**All HIGH and MEDIUM findings are fixed and verified** (unit tests + 52 RLS
integration tests against real Postgres + the money mutation gate). This
document is the durable record.

## Threat model note — why RLS gaps are directly exploitable

Migration `0085` grants the `authenticated` role blanket DML on all tables, so
**RLS is the sole server-side gate for direct PostgREST calls**: anyone can take
the public `PUBLIC_SUPABASE_ANON_KEY` (baked into the browser bundle by design) +
their own login JWT and `POST/PATCH/DELETE` straight at `/rest/v1/*`, bypassing
every service-layer check. A policy that is `USING`-only or has a partial
`WITH CHECK` is therefore a live hole, even when the app's own code paths look
safe. The app writes the affected tables via the **service-role** client (which
bypasses RLS), so the fixes below don't change any legitimate app path.

---

## Findings & fixes

### CRITICAL / HIGH

| # | Finding | Fix |
|---|---------|-----|
| **A1** | `seller_profiles` UPDATE/INSERT had no `WITH CHECK` column-pin (regression after `0072` split `profiles`). Any user could `PATCH` `stripe_onboarded:true` / `stripe_connect_status:'verified'` / `seller_verified_at`, or `INSERT` a pre-verified row → trust-score inflation → **moderation auto-approval**, spoofed "verified seller" badge, purchase-onboarding-gate bypass. | `0097`: pin the webhook-controlled columns on UPDATE via a `SECURITY DEFINER` helper (avoids self-subquery recursion); safe-defaults on INSERT. |
| **M1** | `releaseCommissionFunds` guarded the knitter transfer with only a **24h Stripe idempotency key**. A later second release (chargeback re-freezes to `disputed`, admin resolves as *release* weeks on) paid the knitter **twice** — a colluding buyer+knitter drains 2× the price. | Persistent guard: if `commission_requests.stripe_transfer_id` is already set, the release is a no-op. |
| **M2** | `resolveListingDispute` blindly `cancel()`/`capture()`'d the PI — both **throw on a captured PI**. Listing escrow is captured at ship, so the primary admin dispute tool **500'd on the common "arrived but not as described" case** (couldn't refund a wronged buyer). | Branch on real PI status: `refunds.create` (reverse_transfer + refund_application_fee, idempotent) for a captured charge, cancel only an uncaptured hold, don't re-capture, dead-letter unexpected states. |
| **F1** | `/dev/test-tower` + `/dev/ui-flows` still used the old `.workers.dev` blanket-allow gate **while embedding a service-role-derived admin token in the DOM** — scrape it from any non-prod preview host, then drive `test-exec` (seed admins, simulate payments, mutate any row). | Align both pages with `dev-guard` (`isDevToolsAllowed`: off-localhost requires `DEV_TOOLS='enabled'`). |

### MEDIUM

| # | Finding | Fix |
|---|---------|-----|
| **A2** | `store_members` `FOR ALL USING(has_store_min_role 'admin')` with no `WITH CHECK` → a store **admin** could `PATCH` their own row to `role:'owner'` or `DELETE` the owners = hostile store takeover, bypassing the service's `canAssignRole` + last-owner protection. | `0097`: restrict direct member writes to **owners** only (the app writes via service-role anyway). |
| **A3** | `listings` UPDATE `WITH CHECK` only guarded active-status self-approval; `seller_id` was unconstrained on the new row → reassign a policy-violating listing onto a **victim** (report auto-hide + trust penalties land on them), or set `buyer_id` / an escrow status. | `0097`: `SECURITY DEFINER` helper pins `seller_id` + `buyer_id` and blocks transitions **into** escrow statuses. |
| **M3** | Commission chargeback/refund **after** the knitter transfer (separate charges & transfers → platform balance eats it, transfer not auto-reversed) left **no audit trail**. | `refund_after_payout` dead-letter mirroring the listing path, so support can reconcile / reverse. |
| **I1** | Notification/welcome/draft emails interpolated user-controlled strings (display names, message bodies, listing titles) **raw into HTML** → `<a>`/`<img>`/`<style>` injection for phishing links / tracking pixels inside a trusted transactional email. | Central `esc()` on every leaf value; `btn()` attribute-escapes hrefs; subjects stay plain text. |
| **I2 / A4** | Open redirect: the `next` guard `startsWith('/') && !startsWith('//')` let `/\evil.com` through (browsers normalise `\`→`/` → protocol-relative external). Present in auth callback, Vipps start+callback, onboarding birthday, notifications, profile, dev routes. | Shared `safeInternalPath()` rejecting protocol-relative, backslash, schemes, whitespace/control; applied at every callsite. |
| **F4** | `listing_impressions` shipped `FOR INSERT WITH CHECK (true)` + anon grant → the public anon key allowed **unbounded unauthenticated writes** (table bloat / quota burn / CTR-analytics poisoning). | `0097`: require a real `listing_id` + self-or-null `viewer_id`. |

### LOW / hardening

| # | Finding | Fix |
|---|---------|-----|
| **M4/M5** | money-boundary guard missed `* 0.NN` fee math (only `* 0.0N`); a legacy 13% listing-fee estimate lived outside `money.ts`; two ledger `feeNok` writes didn't round øre→kr. | Broadened the guard regex; moved the estimate into `money.ts` (`legacyListingFeeNokFromTotalOre`); rounded the ledger writes. |
| **F2** | `/api/dev/stripe-mode` leaked a 12-char key fingerprint (4 real secret bytes) to invite-cookie holders. | Fingerprint restricted to staff; stripped to mode-prefix + last 4. |
| **DL** | `resolveDeadLetter` was the one admin service relying **solely** on RLS for authz. | Added an explicit staff-role check (defense in depth). |

---

## Checked and found solid (attempted, rejected)

- **Checkout price/fee tampering**: routes pass only IDs; `purchaseListing`/`payCommission` re-read price+fee from the DB and assemble via `MoneyBreakdown` (validates conservation on construction). You cannot pay 1 kr for a 1000 kr item or zero the fee.
- **Stripe webhook**: signature verified before any mutation; event-level idempotency (`stripe_webhook_events`) + per-handler status guards make replay a safe no-op; metadata amounts are used for the ledger only, never to move money.
- **Middleware gating**: exact segment match (`/admin-foo` ≠ `/admin`); fails closed.
- **Role model**: role is a DB column read via `SECURITY DEFINER` functions; not header/cookie/email-spoofable. `profiles` UPDATE RLS pins role/trust/counters (`0038`).
- **`test-exec`** (RLS-bypassing, arbitrary-actor): double-gated by `devToolsBlocked` (403 on prod builds) + an `ADMINS` email allowlist.
- **Env boundary**: `cloudflare:workers` imported only in `env.ts`; no secrets in `PUBLIC_*`, logs, or the client bundle.
- **Injection**: `.or()`/`.filter()` guarded by `assertSafeForOrFilter`; search uses bound params; file uploads use server-generated paths + whitelist mime/size; `set:html` is only `JSON.stringify` of server objects; no mass-assignment spreads into inserts.
- **CSRF/CORS**: auth cookies `SameSite=Lax`; no wildcard CORS.

## Residual recommendations (not yet actioned — LOW)

- **Rate limiting**: `checkout.ts` (Stripe session creation) and `report.ts` are auth-gated but have no per-user quota → cost/spam abuse. The `assertWithinQuota` machinery already exists; extend it to these two.
- **Security headers**: middleware sets no CSP / `X-Frame-Options` / HSTS.
- **CLAUDE.md drift**: the doc claims authorization flows through `ensureAuthorized()` in `services/types.ts`; that helper doesn't exist (checks are ad-hoc per service). This undercuts the "grep one place for who-can-do-X" guarantee and is likely why the `seller_profiles`/`store_members`/`listings` RLS gaps went unnoticed. Either add the helper or correct the doc.
