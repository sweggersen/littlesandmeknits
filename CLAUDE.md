# CLAUDE.md — Littles and Me Knits

## Project overview

Norwegian knitting platform with three sections:
- **Main site** (`/`) — pattern shop, projects gallery, about
- **Strikketorget** (`/marked`) — classifieds marketplace (buy/sell knitted items, commission knitters)
- **Strikkestua** (`/studio`) — personal knitting studio (projects, yarn stash, tools, tutorials)

Tech: Astro 6 SSR, Tailwind CSS, Supabase (auth + DB + storage), Stripe, Cloudflare Workers.

## Build & dev

```
npm run dev       # dev server at localhost:4321
npm run build     # production build — must pass with zero errors before committing
```

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

- **Design tokens:** `bg-linen` (page bg), `text-charcoal` (text), `terracotta-500` (accent/CTA), `sage-500` (secondary), `oatmeal` (neutral)
- **Label pattern:** `text-[10px] font-bold uppercase tracking-widest text-charcoal/45` — use `StatusBadge` component instead of writing this inline
- **CTA buttons:** `bg-charcoal text-linen px-5 py-2.5 rounded-full text-sm font-medium hover:bg-terracotta-500 transition-colors`
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

## Service layer

API routes use a service layer pattern in `src/lib/services/`. Each service function receives a context object from `buildServiceContext()` (`src/lib/services/context.ts`) and returns via `toResponse()` (`src/lib/services/response.ts`).

## Supabase patterns

- Server-side: `createServerSupabase({ request, cookies })` — uses cookie-based auth
- Admin/bypass RLS: `createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY)`
- Auth: `getCurrentUser({ request, cookies })` — returns user or null
- All tables use Row Level Security

## Language

The UI is in Norwegian (Bokmål). Use `nb-NO` locale for dates and numbers. The i18n system in `src/lib/i18n.ts` supports `nb` and `en` but most marketplace/studio pages are Norwegian-only.
