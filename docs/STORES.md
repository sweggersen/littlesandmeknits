# Stores

Stores are business entities (registered Norwegian organisations) that own
listings, have a public storefront, and can have multiple members with
different roles. Personal sellers continue to work as before; stores layer
on top.

## Data model

```
stores                         business entity (1 row per orgnr)
  ├─ store_members (N)         users + their role for this store
  └─ store_invitations (N)     pending email invites with TTL

listings.store_id (nullable)   if set, listing is store-owned
seller_reviews.store_id (n.)   if set, review attaches to the store
```

Schema lives in `supabase/migrations/0046_stores.sql`. RLS allows the public
to read `status = 'active'` non-deleted stores and the `visible_on_storefront`
member rows; everything else requires membership or service-role access via
the API layer.

## Roles & permissions

Four roles, inherited bottom-up:

```
contributor → manager → admin → owner
```

| Action | Owner | Admin | Manager | Contributor |
|---|:-:|:-:|:-:|:-:|
| Delete / transfer / Stripe | ✓ | | | |
| Manage members | ✓ | ✓ | | |
| Edit store + view finances | ✓ | ✓ | ✓ | |
| Edit any listing | ✓ | ✓ | ✓ | |
| Create + edit own listings | ✓ | ✓ | ✓ | ✓ |

Single source of truth: `src/lib/services/store-permissions.ts`.
**Never inline a role check in a page or API route — always use `can.X(role)`.**

Special rules:
- At least one Owner must exist at all times.
- Owners can't be removed by Admins; only by other Owners or by themselves
  (and only if they're not the last Owner).
- `canAssignRole(actor, target)` ensures Admins can't promote anyone to Owner.

## Code structure

```
src/
  lib/
    brreg.ts                            # Brønnøysundregistrene lookup
    types/stores.ts                     # Shared type definitions
    services/
      store-permissions.ts              # role rank + can.X() predicates
      store-slug.ts                     # slugify + uniqueness + reserved
      store-guard.ts                    # page helper: load + auth-guard
      stores.ts                         # CRUD + storefront read
      store-members.ts                  # role mgmt, presentation
      store-invitations.ts              # invite + accept (token-based)
      store-conversion.ts               # move personal listings to a store
  pages/
    api/stores/                         # REST endpoints (JSON or form)
      index.ts                          #   POST /api/stores
      [slug]/index.ts                   #   PATCH / DELETE
      [slug]/members.ts                 #   invite/role/remove/presentation
      [slug]/convert.ts                 #   move personal listings here
      orgnr-lookup.ts                   #   wizard helper
    api/invitations/[token]/accept.ts
    profile/stores/                     # My stores list + creation wizard
    market/stores/                      # Public browse
    market/store/[slug]/                # Public storefront
    market/store/[slug]/admin/          # Admin dashboard pages
    invite/[token].astro                # Invitation accept landing
```

## Lifecycle

```
draft ── (Brønnøysund lookup ok) ──> pending_review
                                       │
                                       ├── (moderator approves) ──> active
                                       │                              │
                                       └── (moderator rejects) ──> suspended
                                                                      │
                                                          (admin re-approves)
                                                                      ↓
                                                                   active
                                       (owner softDelete) ──> archived + deleted_at
                                                              (recoverable 90 days)
```

The first 20 stores to be approved get `promo_year_one_free = true` — surfaced
on the storefront and admin dashboard as a "founding member" badge.

## Adding a new field to a store

1. ALTER TABLE in a new migration.
2. Add the field to the `Store` interface in `src/lib/types/stores.ts`.
3. If user-editable: add to `UpdateStoreInput` and the `allowed` whitelist in
   `updateStore()`. Add a form input in `admin/settings.astro`.
4. If public: extend `PublicStorefront['store']` in types and the projection
   in `getPublicStorefront`. Render in `[slug]/index.astro`.

## Adding a new role-gated action

1. Add a predicate to `can` in `store-permissions.ts`.
2. Use it in the relevant service function and in the page that surfaces
   the action.
3. Add a unit test in `store-permissions.test.ts` so the matrix is recorded.

## Mobile-app readiness

- All mutation endpoints (`/api/stores/...`) accept JSON, return JSON, and
  authenticate via Supabase cookies (which a mobile webview/Capacitor
  wrapper preserves). No form-data assumptions in the service layer.
- Service functions are pure — no Astro imports — so they could be
  re-exported by a future React Native client running its own
  Supabase context.
- Types in `src/lib/types/stores.ts` are the agreed shape between server
  and any client. Keep them stable.

## Testing

```bash
npx vitest run                          # unit tests
npx playwright test e2e/stores.spec.ts  # e2e (uses real Brønnøysund)
```

Unit-test coverage:
- `brreg.test.ts` — orgnr normalization, MOD11 checksum, lookup result mapping
- `store-slug.test.ts` — slugify, isReserved, isValidSlugSyntax
- `store-permissions.test.ts` — full role matrix and assignment rules

E2E (`e2e/stores.spec.ts`) covers: wizard flow with real orgnr,
moderation via `/api/dev/approve-store`, invitation + accept across two
browser contexts, "Sell as" dropdown, non-member 302, duplicate-orgnr 409.

## What's intentionally NOT done yet

- **Stripe billing (Subscriptions)**: schema columns exist
  (`tier`, `stripe_customer_id`, `stripe_subscription_id`,
  `subscription_status`), but no Checkout integration. Tier is set
  manually in the DB for the MVP launch.
- **Stripe Connect for stores**: existing per-user Connect flow can be
  parameterised by passing `store_id` instead of `user_id`. Not wired yet.
- **Invitation emails**: `inviteMember()` returns the invite URL; emailing
  it is `TODO(email)`. Owner copies the link manually for now.
- **Logo / banner upload UI**: data columns exist, settings UI accepts a
  path, but no upload widget. Existing storage bucket conventions apply.
- **Soft-delete cron purge**: column tracked but cron handler not added.
- **Activity log per member**: not started.

## Decisions captured during design

- Stores are gated by Norwegian orgnr only (Brønnøysund validated). Other
  Nordic countries are post-launch work.
- Multiple Owners allowed; Admins cannot promote to Owner.
- First-come slug, with "Report this store" surfaced on every storefront.
- Slug renames are disallowed initially (canonical URL stability).
- Storefront URL is `/market/store/[slug]` — not top-level `/[slug]` —
  to keep room for future top-level routes.
- Brand byline always says "Weggersen Design" never personal names (see
  user memory).
