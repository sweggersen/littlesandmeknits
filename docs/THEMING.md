# Theming — how the token system works & how to add a theme

The whole site is token-driven: colours, type, radii and shadows resolve to CSS
custom properties at the use-site (Tailwind v4 does this for every utility). A
**theme is one block of token overrides** — you never touch a component to
re-skin the site.

- Source of truth: `src/styles/global.css`
  - `@theme { … }` — the token **defaults** = the production "Linen" look.
  - `:root[data-theme="…"] { … }` — each theme, overriding only what it changes.
- Live playground: **`/dev/theme`** (dev-gated; localhost is always open). Every
  shared primitive + component is rendered there with mock props (no DB), and a
  switcher sets `data-theme` on `<html>` so the whole page (nav + footer too)
  reskins in real time.

## The semantic tokens a theme can override

| Token | Role |
|-------|------|
| `--color-page` / `--color-linen` | Page / body background |
| `--color-surface` | Cards, panels, sheets (replaces raw `bg-white`) |
| `--color-oatmeal` | Muted neutral fills |
| `--color-charcoal` | Body ink (text) |
| `--color-chrome` / `--color-chrome-fg` | Dark chrome (footers/strips) + its text |
| `--color-primary` / `-hover` / `-fg` | Primary action + hover + label |
| `--color-terracotta-*` / `--color-sage-*` | Brand accent scales |
| `--color-used-500 / -300 / -soft` | Brukt section (accent / hover-border / tint) |
| `--color-new-500 / -soft` | Nytt section |
| `--color-commission-500 / -300 / -soft` | Oppdrag section |
| `--color-vipps` / `-hover` | Vipps brand orange (leave alone) |
| `--font-display` / `--font-body` | Display (serif) / body (sans) families |

Anything built on those (e.g. `border-sage-500/10`, `text-charcoal/55`) inherits
the override automatically via the alpha modifier.

## Add a new theme in 3 steps

1. **Register the token block** in `src/styles/global.css`, after the existing
   themes:

   ```css
   :root[data-theme="havblå"] {
     --color-page: #EEF4F5;
     --color-linen: #EEF4F5;
     --color-surface: #FBFDFD;
     --color-charcoal: #16232A;      /* ink */
     --color-chrome: #14242B;        /* dark chrome */
     --color-chrome-fg: #EEF4F5;
     --color-terracotta-500: #1F7A8C;
     --color-primary: #1F7A8C;       /* teal primary */
     --color-primary-hover: #155E6C;
     --color-primary-fg: #FBFDFD;
     /* only override what changes — everything else falls back to @theme */
   }
   ```

2. **List it in the switcher** — add `{ id: 'havblå', label: 'Havblå', hint: '…' }`
   to the `themes` array in `src/components/dev/ThemeSwitcher.astro`.

3. **Check it** at `/dev/theme`: click the new pill and scan the showcase (buttons,
   badges, alerts, cards, table, chrome strip, token swatches). Keep text/background
   pairs **AA-legible** in both light and dark directions.

### Making a theme the real default
Don't edit the `@theme` defaults casually — that changes production. To ship a new
default, set `data-theme` on `<html>` in `src/layouts/Layout.astro` (and
`ShareLayout.astro`) or, more permanently, move the chosen values into the `@theme`
block. The three example themes here (`linen`, `solnedgang`, `kveld`) are
**exploration only**, not a new default.

## Gotchas
- **Zero visual change** is the contract for the default: `--color-surface`,
  `--color-chrome*` etc. default to the exact old literals (`#ffffff`, charcoal,
  linen), so Linen is pixel-identical.
- Status hues in `Alert` / `StatusBadge` (`amber-*`, `red-*`, `blue-*`) ride
  Tailwind's built-in palette — still CSS vars, so a theme *can* override
  `--color-amber-50` etc. if it needs status colours to shift on a dark canvas.
- The `<select>` caret is an SVG data-URI with a baked charcoal stroke; on very
  dark themes it reads faint. Minor, logged in the audit.
- Never re-introduce arbitrary hex (`text-[#…]`) or raw `bg-white` — use the
  tokens above so the next theme just works.
