# Incident runbook

**Worker:** `littlesandmeknits` (Cloudflare) · **DB:** Supabase · **Payments:** Stripe Connect
**Audience:** whoever is on the keyboard when something is wrong. Keep it calm and reversible.

Covers: (1) payments kill-switches, (2) deploy rollback, (3) migration rollback,
(4) a short incident checklist. Companion to the plan in [`june26.md`](../june26.md) §1.4.

---

## 1. Payments kill-switches

Three env-backed switches halt a *class* of money movement without a code
deploy. They are read live from the Cloudflare runtime binding on every
request (see `src/lib/flags.ts`), so flipping one takes effect on the **next
request** — no rebuild.

| Switch (env var) | Blocks | Safe? |
|---|---|---|
| `KILL_PURCHASES` | All new buyer charges: listing purchase, commission payment, listing promotion, pattern checkout. Returns HTTP 503 with a "Kjøp er satt på pause" message. | Yes. No charge is created; buyer simply can't start one. |
| `KILL_PAYOUTS` | Escrow capture/release to sellers: buyer "confirm delivery" (listings + commissions) and the day-14 auto-release cron. Funds stay held in escrow. | Yes. Money stays where it is; releases resume when cleared. `shipListing` still lets sellers mark shipped (capture deferred to cron). |
| `KILL_COMMISSIONS` | Commission ("Strikk for meg") payments specifically (in addition to `KILL_PURCHASES`). | Yes. |

A switch is **engaged** when its value is a truthy string: `on`, `1`, `true`, or `yes` (case/space-insensitive). Anything else (or unset) = off.

**Not affected by `KILL_PAYOUTS`:** moderator-driven dispute resolution
(`disputes.ts`) — by design, so support can still resolve a dispute and
refund/release while a broad payout pause is in effect.

### Engage (stop the bleeding)

Dashboard (fastest): Cloudflare → Workers & Pages → **littlesandmeknits** →
Settings → Variables and Secrets → add/edit `KILL_PURCHASES` = `on` → Save.
Takes effect within seconds on new requests.

CLI:
```bash
# Plaintext var (visible in dashboard, fine for a flag):
echo "on" | npx wrangler secret put KILL_PURCHASES
# (Use the same for KILL_PAYOUTS / KILL_COMMISSIONS.)
```

### Verify it's engaged
- Hit a buyer action and confirm a 503 + the Norwegian pause message, or
- Check the cron response JSON includes `"payoutsPaused": 1` (for `KILL_PAYOUTS`).

### Disengage (resume)
Set the value to `off` (or delete the variable). With `KILL_PAYOUTS` cleared,
the next cron tick auto-releases everything whose `auto_release_at` passed
during the pause — no manual catch-up needed.

### Local dev
Set the same vars in `.dev.vars` (e.g. `KILL_PURCHASES=on`) to exercise the
paths locally. Unit tests inject via `ctx.env` — see `src/lib/flags.test.ts`.

---

## 2. Deploy rollback

Deploys run via the `deploy` job in `.github/workflows/ci.yml` on every push to
`master` (after the `quality` + `database` gates pass): `supabase db push` then
`wrangler deploy`. Manual `wrangler deploy` from local still works as a fallback.

- **Fastest:** Cloudflare dashboard → Workers & Pages → **littlesandmeknits** →
  Deployments → find the last-good deployment → **Rollback**. Instant, no build.
- **From source:** `git checkout <last-good-sha> && npm run build && npx wrangler deploy`,
  then return to the branch.

If the bad deploy also shipped a migration, roll the deploy back **first**
(stops new writes against the new schema), then assess the migration (§3).

---

## 3. Migration rollback

Migrations are applied via the Supabase SQL editor / CLI. They are **not auto-transactional across the deploy**, which has bitten us before (0038 partial-apply, 0077 broke anon browse — both fixed). Treat schema changes as one-way unless you wrote a down-migration.

1. **Assess blast radius.** `supabase db diff --linked` to see prod vs local schema drift. If empty, prod matches the repo.
2. **Prefer roll-forward.** Most issues are a missing GRANT/policy — ship a new corrective migration (as 0080 did for 0077) rather than reversing.
3. **If a true reversal is needed** and the migration has no down-SQL: write the inverse DDL by hand, test it against **local** first (`supabase db reset` then apply through the suspect migration, then your reversal), and only then run on prod.
4. **Always** re-run the RLS test suite (`src/lib/__tests__/rls.test.ts`, integration specs) before declaring resolved.

> Migrations now reach prod via `supabase db push` in the CI `deploy` job, and the `database` gate applies every migration from scratch on each PR — so a broken migration fails CI, not prod. The `db diff --linked` step logs prod-vs-repo drift before each push.

---

## 4. Incident checklist

1. **Contain.** Money misbehaving? Engage the narrowest kill-switch (§1) before debugging. Stopping new charges is cheap and fully reversible.
2. **Capture.** Note the time, what you saw, and the deploy SHA in flight (`wrangler deployments list`). Screenshot Stripe/Supabase dashboards.
3. **Diagnose.** Check `dead_letter_events` (money-path failures land here), Stripe Dashboard → Events/Logs, and Cloudflare → Workers → Logs.
4. **Fix or roll back.** Prefer a deploy rollback (§2) over a hotfix under pressure.
5. **Resume.** Clear the kill-switch (§3 disengage). Confirm a real charge + a real release succeed.
6. **Write it up.** What broke, why the switch/rollback worked (or didn't), and which test would have caught it (add that test — standing rule in CLAUDE.md).

---

## Reference
- Switch logic + guards: `src/lib/flags.ts`, used in `listings.ts`, `commissions.ts`, `promotions.ts`, `checkout.ts`, and `api/cron/run.ts`.
- Failure-mode handling (chargebacks, payout failures): june26 §1.2.
