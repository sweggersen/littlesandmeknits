// Single source of truth for the site-wide theme.
//
// A theme is exactly one block of CSS custom-property overrides in
// `src/styles/global.css` (see docs/THEMING.md). Because Tailwind resolves every
// colour/spacing/radius utility to `var(--color-*)` at the use-site, changing
// THIS ONE VALUE re-skins the ENTIRE site — every page, nav, card, and control —
// with no component edits.
//
// Layout.astro stamps it as `data-theme` on <html>; the /dev/theme playground
// previews the others and restores to this on leave.

export type ThemeId =
  | 'linen'       // light, neutral (the original look)
  | 'solnedgang'  // light, warm high-contrast
  | 'skog'        // light, forest green
  | 'hav'         // light, cool teal
  | 'lavendel'    // light, soft plum
  | 'kveld'       // dark, soft charcoal
  | 'natt';       // dark, deep near-black

/** The active site-wide theme. Change this one line to re-skin everything. */
export const SITE_THEME: ThemeId = 'kveld';
