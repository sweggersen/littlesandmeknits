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

### B1. Stripe account + Connect
- [ ] The platform Stripe account must be the **registered business entity**
  (Weggersen Design / the AS), **not a personal account** — payouts and the
  platform fee flow through it.
- [ ] Enable **Stripe Connect** on that account (Dashboard → Connect → Get
  started). Sellers onboard as Custom accounts, stores as Express — both need
  Connect on.
- [ ] Complete the platform's own business verification (bank account, KYC) so
  it can receive the application fee.

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
  `VIPPS_ENV=production`.

### B4. Email + shipping secrets
- [ ] `RESEND_API_KEY` set, and the **sending domain verified** in Resend
  (SPF/DKIM) so invite/notification emails don't spam-folder. Confirm
  `EMAIL_FROM` uses that verified domain.
- [ ] *(Optional, for real shipping labels)* `BRING_API_UID`, `BRING_API_KEY`,
  `BRING_CUSTOMER_NUMBER`. If unset, sellers keep the manual-tracking fallback.

### B5. Verify the rest of the secrets are present
On the Worker, confirm these exist (most are already set): `SUPABASE_SERVICE_ROLE_KEY`,
`CRON_SECRET`, `VAPID_PRIVATE_KEY`, `LOGIN_INVITE_KEY`. The `PUBLIC_*` set is
baked by CI — don't set those as runtime secrets.

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
| `VIPPS_CLIENT_ID` / `_CLIENT_SECRET` / `_MSN` / `_SUBSCRIPTION_KEY` / `VIPPS_ENV=production` | B3 | |
| `RESEND_API_KEY` / `EMAIL_FROM` | B4 | verified domain |
| `BRING_API_UID` / `_API_KEY` / `_CUSTOMER_NUMBER` | B4 | optional |
| `FLAG_SECTION_OPPSKRIFTER` / `_BRUKT` / `_NYTT` / `_OPPDRAG` / `_BUTIKKER` = `on` | C | one at a time |
