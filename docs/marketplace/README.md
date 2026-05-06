# Marketplace exploration

This folder is the comprehensive plan for adding a marketplace dimension
to Littles and Me — without replacing the existing pattern shop, project
log, or yarn/needle inventory. It lives on the `marketplace-exploration`
branch as planning material; nothing here ships to prod until each piece
graduates into a real PR.

## Reading order

1. [00-overview.md](./00-overview.md) — strategy, pillars, non-goals, success metrics
2. [01-data-model.md](./01-data-model.md) — entities, RLS shape, draft SQL
3. [02-payments.md](./02-payments.md) — Stripe Connect, Vipps, escrow, MVA
4. [03-ux-ia.md](./03-ux-ia.md) — information architecture and key flows
5. [04-trust-fees-legal.md](./04-trust-fees-legal.md) — fee tiers, trust UI, NO law
6. [05-rollout.md](./05-rollout.md) — phased plan with exit criteria

## Companion artifacts

- `supabase/migrations-draft/marketplace.sql` — schema sketch (DO NOT apply
  to prod; it has not been reviewed and assumes additions only).
- `src/pages/studio/marked/index.astro` — route stub so the IA addition is
  visible in the studio shell. Currently a placeholder landing page.

## Stack assumptions (already true today)

- Astro 6 + React 19, Tailwind 4
- Supabase (auth, Postgres + RLS, storage)
- Stripe (one-shot pattern checkout already wired in `src/lib/stripe.ts`
  and `src/pages/api/stripe/webhook.ts`)
- Cloudflare Workers deploy
- Norwegian-first (`nb`), English secondary (`en`)
