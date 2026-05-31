# CLAUDE.md — Littles and Me Knits

> **⚠ Refactor in progress.** See [`refactor.md`](./refactor.md). Until those checkboxes are ticked, ship no new features that bypass the rules below. Items 1, 4, 11, 16 are ship-stopping — features wait on them.

## Project overview

Norwegian knitting platform with three sections:
- **Main site** (`/`) — pattern shop, projects gallery, about
- **Strikketorget** (`/marked`) — classifieds marketplace (buy/sell knitted items, commission knitters)
- **Strikkestua** (`/studio`) — personal knitting studio (projects, yarn stash, tools, tutorials)

Tech: Astro 6 SSR, Tailwind CSS, Supabase (auth + DB + storage), Stripe, Cloudflare Workers.

## Build & dev

```
npm run dev         # dev server at localhost:4321
npm run dev:fresh   # same, but wipes node_modules/.vite first (clears stale Vite cache)
npm run build       # production build, must pass with zero errors before committing
```

**Recurring Vite cache issue**: when the dev server starts throwing
"fetch failed" / "Invalid hook call" / "module not found" errors mid-session,
the optimized-deps cache is stale. Kill the dev server and run
`npm run dev:fresh` to clear it. Doesn't affect prod builds.

## Architecture rules

### Use shared components — never inline UI patterns

We did a major cleanup extracting 14 shared components from duplicated inline markup across 15+ pages. **Do not re-introduce duplication.** Before writing any UI, check if a component already exists.

**Layout wrappers — always use these, never build raw page shells:**

| Component | Use for | Notes |
|-----------|---------|-------|
| `MarketplaceShell` | All `/marked` pages | Provides MarketplaceNav + `max-w-5xl` container. **Never import MarketplaceNav directly in pages.** |
| `StudioLayout` | All `/studio` pages | Provides StudioNav + container |
| `Layout` | All other pages | Base HTML shell |
| `AdminLayout` | All `/admin` pages | Admin nav + auth guard |

**MarketplaceShell has a hardcoded `max-w-5xl` width.** Do not add a `maxWidth` prop or override widths. All marketplace content uses the same width. If a form needs to be narrower, the form itself can have a `max-w-lg` or similar — but the page container stays 5xl.

**Card components:**

| Component | Props | Used for |
|-----------|-------|----------|
| `ListingCard` | id, title, price, imgUrl?, meta?, isFav?, showFav?, inactive? | Listing grids everywhere (brukt, nytt, index, favoritter, selger, profil) |
| `CommissionCard` | id, title, category, sizeLabel, budgetMin, budgetMax, offerCount?, buyerName?, neededBy?, daysLeft?, inactive? | Commission request grids |
| `ProjectCard` | id, title, status, heroPhotoPath?, compact?, isCommission?, buyerName? | Studio project lists. Has `compact` mode for horizontal layout |

**UI primitives — use instead of inline markup:**

| Component | Replaces |
|-----------|----------|
| `StatusBadge` | Inline `<span class="text-[10px] font-bold uppercase tracking-widest rounded-full ...">` status pills |
| `Alert` | Inline colored message boxes (success/warning/error/info) |
| `EmptyState` | Inline "no items" messages with optional CTA |
| `ProfileAvatar` | Inline avatar image-or-initials circles |
| `StarRating` | Inline star SVG loops |
| `LoadMore` | Inline "load more" pagination links |
| `FilterPanel` | Inline filter forms (category, price, age fields) |
| `ListingToolbar` | Inline search + filter toggle + grid/list view switcher |
| `FavScript` | Inline favorite toggle JS (except favoritter page which has custom remove-on-unfavorite animation) |
| `ReportButton` | Inline report/flag buttons |

### Labels and display strings

All Norwegian display labels for statuses, categories, conditions etc. live in `src/lib/labels.ts`. **Never hardcode Norwegian status/category strings in page files.** Import from labels.ts:

```ts
import { CATEGORY_LABEL, LISTING_STATUS, COMMISSION_STATUS, KIND_LABEL } from '../lib/labels';
```

### Time formatting

Use `src/lib/time.ts` for `timeAgo()` and `formatDate()` — never inline date formatting logic.

### Storage URLs

Use `projectPhotoUrl()` from `src/lib/storage.ts` for all Supabase storage image URLs.

## Styling conventions

- **Palette tokens:** `bg-linen` (page bg), `text-charcoal` (text), `terracotta-500` (brand accent), `sage-500` (secondary), `oatmeal` (neutral).
- **Semantic tokens (preferred for new code):** `bg-primary`, `text-primary-fg`, `hover:bg-primary-hover`. Defined in `src/styles/global.css` `@theme` so a single edit re-skins every primary action site-wide.
- **Label pattern:** `text-[10px] font-bold uppercase tracking-widest text-charcoal/45` — use `StatusBadge` component instead of writing this inline.
- **CTA buttons:** Use the `btn-primary` utility class (defined in `@layer components`), combined with sizing classes. Example: `class="btn-primary px-5 py-2.5 rounded-full text-sm font-medium"`. Equivalent to `bg-primary text-primary-fg hover:bg-primary-hover transition-colors` if you want it inline.
- **`bg-charcoal text-linen` is page chrome** (footers, dark nav strips). For interactive primary actions, always use the primary tokens instead.
- **Cards:** `bg-white rounded-2xl border border-sage-500/10` (or `rounded-3xl` for larger containers)
- **Font:** Serif for headings (`font-serif`), sans for body
- **Content width:** `max-w-5xl` for all marketplace pages (enforced by MarketplaceShell). Do not create pages with different widths.

## Navbar responsive breakpoints

- `lg` (1024px+): Full nav — text links (Oppskrifter, Prosjekter, Om oss) + section pills (Strikketorget, Strikkestua)
- `sm`–`lg` (640–1024px): Brand + section pills + right-side icons + hamburger
- Below `sm` (<640px): Brand + hamburger only. Section pills appear inside the hamburger menu at the top, centered

## Client-side scripts and View Transitions

This site uses Astro's `ClientRouter` (view transitions). Module `<script>` tags only execute once — after a client-side navigation, the DOM is new but old listeners are gone. **Every script that queries the DOM must use `astro:page-load`:**

```ts
// CORRECT — re-attaches after every navigation
function initMyFeature() {
  document.querySelector('[data-my-btn]')?.addEventListener('click', ...);
}
document.addEventListener('astro:page-load', initMyFeature);
```

Do NOT also call `initMyFeature()` directly — `astro:page-load` fires on initial load too, so a direct call would double-bind.

Exception: `<script is:inline>` re-runs on every page load (used by Navbar). Only use `is:inline` when you need `define:vars` or must avoid Astro's module bundling.

## Service layer (mandatory pattern, not a suggestion)

**Every write goes through a function in `src/lib/services/`.** API routes never inline `db.from(...).insert/update/delete(...)` or contain authorization checks. The route's job is: parse input → `buildServiceContext()` → call the service → `toResponse()`.

Why mandatory: it's the only way to grep "who can do X" and get one answer. Refactor item #1 is the audit that completes the migration; until then, every new route follows the rule even if siblings don't.

```ts
// ✅ correct
export const POST: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const form = await request.formData();
  const result = await someService.doThing(ctx, { foo: form.get('foo') });
  return toResponse(result);
};

// ❌ wrong — inline DB writes in the route
export const POST: APIRoute = async ({ request, cookies }) => {
  const user = await getCurrentUser({ request, cookies });
  const supabase = createServerSupabase({ request, cookies });
  await supabase.from('listings').update(...);   // NO
  return new Response('ok');
};
```

**Exceptions allowed:** Stripe webhook handler (entry point, no user), `/api/dev/*` (dev tooling — but see refactor item #5: dev actions should call real services, not duplicate logic), `/api/auth/vipps/*` (OIDC dance has its own flow).

## Supabase access rules

- **`createServerSupabase({ request, cookies })`** — cookie-bound, respects RLS. Use this in services for ordinary reads/writes.
- **`createAdminSupabase(serviceRoleKey)`** — service role, bypasses RLS. **Forbidden in page modules and route handlers.** Allowed inside `src/lib/services/*` when the operation genuinely needs to span users (notifications, webhook side-effects, admin tools). Each admin-client call should have a comment one line above explaining *why* RLS doesn't fit.
- **`getCurrentUser(...)`** — auth-gated routes use the new `Astro.locals.user` from middleware (refactor item #13). Don't reinvent the inline `if (!user) return Astro.redirect('/login?next=...')` pattern; the middleware now does it.
- **All tables use Row Level Security.** A new table or sensitive column lands with at least one positive + one negative RLS test (refactor item #11). Pull-requests adding tables without RLS tests get rejected.

## Authorization rules

- **One canonical path:** services receive a verified `ctx.user` and check ownership/role against the resource using `ensureAuthorized()` helpers in `src/lib/services/types.ts` (per refactor item #4).
- **Never gate authorization in a UI page.** Pages display, services authorize. If you find yourself writing `if (user.id !== listing.seller_id) return Astro.redirect(...)` in a page, that logic belongs in a service.
- **No silent admin-bypass.** Reaching for `ctx.admin` to "make the query simpler" is the classic foot-gun. Use it only when the operation genuinely transcends a single user.

## Commerce paths — no silent failures

Any service touching money (Stripe, payouts, refunds, escrow capture) must either:
1. Roll back fully on error (throw or return `fail(...)` and let the caller handle), or
2. Land the failure in `dead_letter_events` via `recordDeadLetter()` (per refactor item #16) so support can audit.

**Forbidden pattern:**
```ts
try { await stripe.something(...); } catch (e) { console.error(e); /* continue */ }
```
That's a bug report waiting six months. Either roll back or dead-letter.

## Data model rules

- **Don't add columns to `profiles`.** Per refactor item #2, that table is being split into `profiles` (display identity), `seller_profiles` (payout/KYC), `buyer_preferences` (interests/flags), `auth_identities` (provider records). New seller-payout fields, new onboarding flags, new identity providers — all land in the appropriate table.
- **Migration discipline:** sensitive columns must have RLS that lets only the data subject + authorised staff read. The migration PR includes the corresponding test in `e2e/rls.spec.ts` or `src/lib/__tests__/rls.test.ts`.
- **No `as any` on Supabase results.** Once `src/lib/database.types.ts` is in place (refactor item #3), the typed client exposes proper return shapes. If you reach for `as any`, you're hiding a real bug — fix the type instead, with a one-line comment if the cast is genuinely unavoidable.

## Env access boundary

`import { env } from 'cloudflare:workers'` is allowed in exactly **one file**: `src/lib/env.ts` (per refactor item #10). Every other module calls `getEnv()`. This is the swap point if we ever move off Cloudflare Workers.

## Client-side scripts

Inline `<script>` blocks in pages are deprecated. New client behaviour goes in `src/lib/client/controllers/<name>.ts` and is registered via the central `astro:page-load` handler (per refactor item #9). The exceptions called out earlier (`<script is:inline>` for `define:vars`, the navbar persistence dance) remain.

## File-size rule

No Astro page > 600 lines. If a page is hitting that, it's a state machine pretending to be a template — extract per-state components into `src/components/<domain>/<State><Role>.astro` (per refactor item #6).

## Language

The UI is in Norwegian (Bokmål). Use `nb-NO` locale for dates and numbers. The i18n system in `src/lib/i18n.ts` supports `nb` and `en` but most marketplace/studio pages are Norwegian-only.

### Punctuation

- **No em-dash (`—`)** in Norwegian copy. Use commas, periods, or parentheses instead. Reads like English-translated copy otherwise.
- **En-dash (`–`)** is fine for numeric ranges (`9–29 kr`, `3–5 år`).
- **Centre dot (`·`)** is OK as a separator in titles and button labels (`Hjelp · Strikketorget`, `Bekreft kjøp · 294 kr`).
- Code comments and dev-only strings (debug logs, test labels) can keep em-dashes — the rule is about user-facing copy.

## Test coverage is required for every new feature

**Standing rule**: when you add a feature, you also ship the tests that cover it. The codebase has three test layers — use whichever fits:

| Layer | Where | When to use |
|-------|-------|-------------|
| **Vitest unit** | `src/**/*.test.ts` (next to the source file) | Pure functions, service helpers without I/O, formatters, derivations. Fast, no DB. |
| **Playwright e2e** | `e2e/*.spec.ts` | UI flows that touch real pages. Auth-gated screens. Anything where the assertion is "does the user see X". |
| **UI Flows page scenario** | `src/pages/dev/ui-flows.astro` (FLOWS array) | Visual regression / demo coverage. Especially valuable for cross-persona flows and shortcut-heavy demos where you'd hand-walk someone through. |

Rules of thumb:

- A new page route → at least one Playwright e2e that loads it as the expected persona and asserts a heading or key text.
- A new server action / API endpoint → a unit test for the pure parts AND/OR an e2e that triggers it through the UI.
- A new UI surface (button, modal, form section) → a UI Flows scenario so it's clickable in `/dev/ui-flows` for visual review.
- A new field on `profiles` / `listings` / etc — either e2e setting the value through the UI, or a service-layer unit test, or both.
- A bug fix — add the test that would have caught it. If you can't write one, leave a `// TODO: cover with test` note explaining why.

Helpers you'll often need:
- `test-exec` actions in `src/pages/api/dev/test-exec.ts` for seeding, lookups, and bypassing flows (Stripe Checkout, file pickers). Add new actions here when needed.
- `set-profile-visible`, `lookup-user`, `count-notifications`, `count-follows`, `seed-screens`, `seed-buyflow-listing` are pre-built and used by existing specs.
- `/dev/screens` is the mock-click harness for manual visual review. Adding a screen there is free coverage and helps non-dev viewers see the platform.

Running tests:
```
npm test                                                # vitest unit
npx playwright test --project=chromium --reporter=list  # full e2e
npx playwright test follow-feed.spec.ts                 # single spec
```

The build (`npm run build`) is not a substitute for tests — TypeScript and Astro check shapes, not behaviour.
