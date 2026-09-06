# Themeability Audit — 2026-09

Goal of the themeable-foundation work: make the whole site **100 % token-driven**
so a theme is *one block of token overrides* and never touches a component. This
document records (a) how token-driven the codebase already was, (b) the gaps that
bypassed the token system, and (c) what changed to close them. The production
default look ("Linen") is unchanged — verified pixel-for-pixel (see the bottom
section).

## How token-driven was it already? (Short answer: mostly.)

Tailwind CSS v4 compiles **every** colour/spacing/radius/shadow/type utility to a
CSS custom property at the use-site. `bg-sage-500`, `text-charcoal`, `bg-amber-50`,
`rounded-2xl`, `shadow-md` all emit `var(--color-…)` / `var(--radius-…)` /
`var(--shadow-…)`. So the vast majority of the UI was *already* re-skinnable by
redefining those variables — the `@theme` block in `src/styles/global.css` is the
single source of truth, and `.btn-primary`, `.label-eyebrow`, `.label-form`, the
`::selection`, select-caret, and studio tab-bar rules all already read tokens.

Of ~185 rendered files, **59 were already fully token-driven** (zero findings).
The genuine bypasses fell into a few buckets:

| Bucket | What it is | Why it bypasses tokens |
|--------|-----------|------------------------|
| Arbitrary bracket hex | `text-[#915f3a]`, `bg-[#f3ece1]`, `border-[#b08968]/40` | Compiled as a **literal** colour, not a `var()` — a theme can't reach it |
| Inline `style` hex | Vipps button `style="background-color:#FF5B24"` | Literal, not tokenised |
| Component `<style>` hex / rgba | DashboardEngine editor chrome, become-seller status colours, share-image | Literal |
| Raw `bg-white` (semantic surface) | 343 occurrences / 121 files | Technically `var(--color-white)`, but white is not a *surface role* a theme should be able to re-tint |

## Category 1 — Hardcoded hex (the real bypasses)

### 1a. Section-accent trio (the big recurring one) — **FIXED**
Three brand-section hues were hardcoded as arbitrary Tailwind values across 6 files:
- `#915f3a` brown = **Brukt/used**, `#5d6f4b` green = **Nytt/new**,
  `#6f5494` purple = **Oppdrag/commissions**, plus tint/hover variants
  `#b08968`, `#f3ece1`, `#e6f0e9`, `#9b7fc4`, `#efe9f7`.

Files: `MarketplaceNav.astro`, `StrikketorgetNav.astro`, `pages/market/index.astro`,
`pages/market/used.astro`, `pages/market/new.astro`, `pages/market/commissions/index.astro`.

**Fix:** promoted to tokens `--color-used-500 / -300 / -soft`, `--color-new-500 / -soft`,
`--color-commission-500 / -300 / -soft` and rewrote all six files to
`text-used-500` / `bg-used-soft` / `border-commission-300/40` etc. Zero literals remain.

### 1b. Vipps brand orange — **FIXED (tokenised)**
`#FF5B24` / hover `#E04E1C` in `LoginContent.astro` and `StrikketorgetNav.astro`
(inline style + JS hover swap). Vipps is a mandated third-party brand colour, but
it's now a token (`--color-vipps` / `--color-vipps-hover`) so it lives in one place.
Themes should leave it alone.

### 1c–1g — **DOCUMENTED, not yet migrated** (follow-ups)
These remain literal and are logged for a future pass. They render correctly and
are lower-traffic / harder to tokenise without risk:
- **Navbar.astro** L298-299 — moderator-bell amber `#d97706` / `#92400e` (inline `<style>`).
- **profile/become-seller.astro** L247-250 — account-status greens/reds (`#7a8a6e`, `#c0392b`, `#5f6f54`, `#b23c2a`).
- **dashboard/DashboardEngine.astro** — the widget-editor toolbar defines its own dark palette
  (`#3B3733`, `#F7F2EA`, `#C2604A`, `rgba(122,138,110,.3)`, `rgba(194,96,74,.5)`) parallel to
  charcoal/linen/terracotta. Strong consolidation candidate.
- **studio/projects/[id].astro** — 1080×N Instagram share-image inline styles duplicate
  linen/charcoal/terracotta + hardcode `'Fraunces'`/`'Inter'`. The fixed pixel canvas is
  intentional; colours/fonts should still pull from tokens.
- **market/store/[slug]/(admin)** — `#C97B5D` fallback for the user-configurable per-store
  accent (`--store-accent`). The mechanism (CSS var) is already right; only the literal
  default should reference a token.

## Category 2 — Raw `bg-white` (semantic surface) — **FIXED**
343 occurrences across 121 files, the single largest bypass. `bg-white` was the de-facto
card/panel/sheet colour with no way for a theme to re-tint surfaces independently of
literal white.

**Fix:** added `--color-surface` (default `#ffffff`, so identical) and codemodded every
`bg-white` → `bg-surface` (incl. opacity variants `bg-white/85` → `bg-surface/85`). Now a
theme re-tints all surfaces from one token. `bg-black/40`-style image scrims were left as-is
(legitimate overlays, not surface roles).

## Category 3 — Arbitrary `rgb()`/`hsl()` in brackets
**None** as Tailwind arbitrary values. The only rgba literals are inside inline/`<style>`
blocks already listed in 1c–1g (overlay scrims + editor borders).

## Category 4 — Ad-hoc fonts / shadow / radius
- **Fonts:** only the studio share-image (`studio/projects/[id].astro`) hardcodes
  `'Fraunces'`/`'Inter'` (logged in 1g). Everything else uses `font-serif`/`font-sans`.
  Added semantic aliases `--font-display` / `--font-body` for new work.
- **Shadow / radius:** no `shadow-[…]` or `rounded-[…]` arbitrary values anywhere. Radii and
  shadows already ride Tailwind's `--radius-*` / `--shadow-*` scale — a theme can override
  those in its block if desired (they were left at defaults here).

## Chrome decouple — **NEW tokens**
`bg-charcoal text-linen` is page chrome (footers, dark strips). Charcoal was overloaded as
*both* the body-ink colour and the dark-chrome surface, which makes a dark theme impossible
(flipping ink light would flip chrome light too). Added `--color-chrome` / `--color-chrome-fg`
(defaults = charcoal/linen, so no visual change) and migrated `Footer.astro` +
`StrikketorgetFooter.astro` to `bg-chrome` / `text-chrome-fg`. The dark example theme keeps
chrome dark while ink goes light. (Small chrome like tooltips / file-input chips still use
`bg-charcoal`; they stay legible under themes and can be migrated later.)

## Dev-only files (left as-is by design)
`src/pages/dev/test-tower.astro` (~84 literals — its own diagnostic palette), `dev/ui-flows.astro`
(device-frame border), `dev/offline.astro` (self-contained offline fallback, intentionally
no external CSS). Not user-facing; out of scope.

## Summary of tokens added (all in `src/styles/global.css` `@theme`)
- Surfaces: `--color-surface`, `--color-page`
- Chrome: `--color-chrome`, `--color-chrome-fg`
- Sections: `--color-used-500/-300/-soft`, `--color-new-500/-soft`, `--color-commission-500/-300/-soft`
- Brand: `--color-vipps`, `--color-vipps-hover`
- Type: `--font-display`, `--font-body`

Plus three theme blocks (`:root[data-theme="linen|solnedgang|kveld"]`) and the
`/dev/theme` playground + `docs/THEMING.md`.

## Verification — default look unchanged
Before/after screenshots at 1280px, full-page, Astro dev-toolbar hidden, pixel-diffed
with `sharp`:

| Page | Result |
|------|--------|
| `/` (home) | **0 differing pixels** |
| `/dev/screens` (DB-free component catalog) | **0 differing pixels** |
| `/market/used` | 0 diff in the same-DB window (later runs shifted only because a concurrent agent was seeding listings — page height changed, not styling) |
| `/market` (index) | same as above |

`dev/screens` renders `ListingCard`, `StatusBadge`, `Alert`, avatars, etc. with mock data, so
its 0-diff is direct proof the component refactors are visually identical. `npm run build` and
`npm test` (911 passing) both green.
