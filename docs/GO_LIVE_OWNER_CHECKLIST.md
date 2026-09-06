# Go-live owner checklist

The code work (M1–M6) is done. These are the steps **only you** can do — they
touch live secrets, dashboards, and the business Stripe account. Work top to
bottom: Phase A is safe to do anytime; Phase B (M0) gates every money section;
Phase C flips the sections on one at a time after each proves out.

**How to set a Worker secret** (used throughout): Cloudflare → Workers & Pages →
**littlesandmeknits** → Settings → **Variables and Secrets** → add → Save
(takes effect in seconds, no redeploy). Or CLI: `echo "VALUE" | npx wrangler secret put NAME`.
`PUBLIC_*` values are NOT secrets — they're baked in CI and already set.

---

## Phase A — M6 config (safe to do now, independent, low risk)

- [ ] **Sentry DSN** — set `SENTRY_DSN` on the Worker to your Sentry project's
  DSN. Without it, the new SSR-500 reporting silently no-ops. Verify: after
  setting, trigger any error and confirm it appears in Sentry.
- [ ] **Cron dead-man's-switch** — create a check at healthchecks.io (or
  similar), set `CRON_HEARTBEAT_URL` on the Worker to its ping URL. The cron
  pings it every run; if the cron stalls, healthchecks pages you (today a stall
  is only visible if you happen to open `/admin`).
- [ ] **Supabase PITR** — Dashboard → Database → **Backups**. Confirm the tier
  and **enable Point-in-Time Recovery** before real orders exist. Then fill in
  the retention line in `INCIDENT_RUNBOOK.md §3b`. (Daily-only backups = up to
  24h of orders/payouts lost in a bad-migration incident.)

---

## Phase B — M0 go-live foundation (gates ALL money sections)

### B1. Business entity + Stripe account + Connect
**DECISION (2026-09): set up an AS first, then create the Stripe platform under
the AS.** Weggersen Design is currently a registered *enkeltpersonforetak* (ENK)
with an orgnr, but the plan is an AS. This matters BEFORE creating the Stripe
account because:
- The Stripe account is a Connect **platform**. Once sellers/stores onboard
  connected accounts under it, you can't move the platform to a different legal
  entity without every connected account re-onboarding. Pre-launch (zero
  connected accounts) is the cheapest moment to get the entity right.
- Sellers onboard as **Custom** accounts (`stripe-connect.ts`) → the platform is
  liable for those accounts (KYC/disputes/losses). Stores onboard as **Express**
  (`store-connect.ts`, orgnr as tax_id). The platform collects an application fee.

Prereqs (with your accountant — not covered here, it's tax/legal):
- [ ] Register the **AS** (min 30 000 NOK aksjekapital). Moving the ENK into the
  AS is usually done via **skattefri omdanning** — confirm the route + timing
  with a regnskapsfører.
- [ ] AS has an **orgnr** + a **NOK business bank account**.

Then in Stripe (once the AS exists):
- [ ] Create/set the Stripe account's identity to the **AS**: Settings →
  Business → legal name, orgnr, address, NOK bank account. Complete the
  platform's own verification (representative ID + business docs).
- [ ] Enable **Stripe Connect** (Dashboard → Connect → Get started). Fill the
  platform profile + loss-liability model (Custom = you're on the hook).
- [ ] Confirm **Custom** (sellers) and **Express** (stores) account types are
  both available; set Connect branding + statement descriptor.

### B2. Stripe live keys + webhook
- [ ] Copy the **live secret key** (`sk_live_…`) → set `STRIPE_SECRET_KEY` on the
  Worker. (Never share this with me — owner-only.)
- [ ] Create a **live webhook endpoint**: Stripe → Developers → Webhooks → Add
  endpoint → URL `https://www.littlesandmeknits.com/api/stripe/webhook`.
  Subscribe to exactly these events:
  `checkout.session.completed`, `account.updated`, `charge.dispute.created`,
  `charge.dispute.closed`, `charge.refunded`, `payment_intent.payment_failed`,
  `payment_intent.canceled`, `payout.failed`.
- [ ] Copy that endpoint's **signing secret** (`whsec_…`) → set
  `STRIPE_WEBHOOK_SECRET` on the Worker.

### B3. Vipps (production)
- [ ] From the Vipps merchant portal, set on the Worker: `VIPPS_CLIENT_ID`,
  `VIPPS_CLIENT_SECRET`, `VIPPS_MSN`, `VIPPS_SUBSCRIPTION_KEY`, and
  `VIPPS_ENV=prod`. **Exactly `prod`** — the code checks `VIPPS_ENV === 'prod'`
  (`vipps.ts`), so any other value (e.g. `production`) silently keeps Vipps in
  test mode and everyone logs into the test bank. The preflight (B5) flags this.

### B4. Email + shipping secrets
- [ ] `RESEND_API_KEY` set, and the **sending domain verified** in Resend
  (SPF/DKIM) so invite/notification emails don't spam-folder. Confirm
  `EMAIL_FROM` uses that verified domain.
- [ ] *(Optional, for real shipping labels)* `BRING_API_UID`, `BRING_API_KEY`,
  `BRING_CUSTOMER_NUMBER`. If unset, sellers keep the manual-tracking fallback.

### B5. Verify everything with the launch preflight
Once B2–B4 are set, log in as an admin and open **`/admin/preflight`** (Admin nav
→ "Lanseringssjekk"). It inspects the live Worker env and classifies every
required secret — **live vs test/sim, prod vs local, set vs missing** — as
green/amber/red. It never shows a secret value, only its state.

- [ ] **Preflight reads "Klar for lansering"** (zero red/blocking rows). This is
  the one-glance replacement for hand-checking each secret. It catches the silent
  traps: a `sk_test_`/`sk_simulate` Stripe key, `VIPPS_ENV` ≠ `prod`, a localhost
  Supabase URL, or an accidentally-on `KILL_*` switch. Amber rows are
  non-blocking (e.g. no Sentry) — clear them if you want, but they won't stop a
  launch. (Scriptable equivalent: `GET /api/admin/preflight`, admin-authed JSON.)

The remaining always-on secrets (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
`VAPID_PRIVATE_KEY`, `LOGIN_INVITE_KEY`) are covered by their own preflight rows.
The `PUBLIC_*` set is baked by CI — don't set those as runtime secrets.

### B6. Verify the kill-switches work (do this BEFORE opening any section)
- [ ] Set `KILL_PURCHASES=on`, confirm a buy action returns the 503 pause
  message, then set it back to `off`. Repeat for `KILL_PAYOUTS`,
  `KILL_COMMISSIONS`. (See `INCIDENT_RUNBOOK §1`.) This proves your emergency
  brake works before real money moves.

### B7. Real-Stripe smoke (with LIVE keys, one real low-value transaction)
- [ ] One real pattern purchase → confirm the download unlocks (proves the live
  key + webhook + signing secret are all wired). This is also the M2 smoke.

---

## Phase C — Open sections one at a time (after each proves out)

Each flip is a Worker variable: set `FLAG_SECTION_<NAME>=on` (or remove the
`off` value). Do them in this order, and only after that section's smoke passes.

- [ ] **M2 · Oppskrifter** — after the B7 purchase→download smoke:
  `FLAG_SECTION_OPPSKRIFTER=on`.
- [ ] **M3 · Brukt + Nytt** — run the escrow smoke in `GO_LIVE_MILESTONES.md`
  (buy → seller ships → buyer confirms → payout lands; then a refund). Decide
  Bring vs manual labels. Then `FLAG_SECTION_BRUKT=on` + `FLAG_SECTION_NYTT=on`.
- [ ] **M4 · Oppdrag** — shares the escrow rail; after the M3 smoke, do one real
  commission (offer → accept → pay → deliver → release). Then
  `FLAG_SECTION_OPPDRAG=on`.
- [ ] **M5 · Butikker** — onboard a real store to Stripe Connect (the new
  "Utbetalinger" flow in store admin), sell one store-owned listing, confirm the
  payout lands on the **store's** account (not a member's). Then
  `FLAG_SECTION_BUTIKKER=on`.

Profil + Strikkestua are already ON (no money surface, shipped M1).

---

## Quick reference — secrets to set on the Worker

| Secret | Phase | Notes |
|--------|-------|-------|
| `SENTRY_DSN` | A | error reporting |
| `CRON_HEARTBEAT_URL` | A | cron dead-man's-switch |
| `STRIPE_SECRET_KEY` | B2 | `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | B2 | `whsec_…` from the live endpoint |
| `VIPPS_CLIENT_ID` / `_CLIENT_SECRET` / `_MSN` / `_SUBSCRIPTION_KEY` / `VIPPS_ENV=prod` | B3 | `VIPPS_ENV` must be exactly `prod` |
| `RESEND_API_KEY` / `EMAIL_FROM` | B4 | verified domain |
| `BRING_API_UID` / `_API_KEY` / `_CUSTOMER_NUMBER` | B4 | optional |
| `FLAG_SECTION_OPPSKRIFTER` / `_BRUKT` / `_NYTT` / `_OPPDRAG` / `_BUTIKKER` = `on` | C | one at a time |
