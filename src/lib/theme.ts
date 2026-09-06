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

/** The active site-wide default. A visitor's own pick (saved under
 *  THEME_STORAGE_KEY) overrides this on their device. */
export const SITE_THEME: ThemeId = 'kveld';

/** localStorage key holding a visitor's chosen theme (applied before paint by
 *  the inline script in Layout, so there's no flash of the default). */
export const THEME_STORAGE_KEY = 'lm-theme';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  /** Swatch: the theme's page background. */
  page: string;
  /** Swatch: the theme's primary accent. */
  primary: string;
  dark?: boolean;
}

/** Presentation metadata for every theme — drives the swatch circles in the
 *  account menu + the dev playground. Colours mirror the token blocks in
 *  global.css; keep them in sync when a theme's page/primary changes. */
export const THEMES: ThemeMeta[] = [
  { id: 'kveld', label: 'Kveld', page: '#1B1A18', primary: '#E08A6B', dark: true },
  { id: 'natt', label: 'Natt', page: '#0E0E10', primary: '#F0A07E', dark: true },
  { id: 'linen', label: 'Linen', page: '#FAF6F0', primary: '#C76D4E' },
  { id: 'solnedgang', label: 'Solnedgang', page: '#FDF3E7', primary: '#B23A1E' },
  { id: 'skog', label: 'Skog', page: '#F1F0E6', primary: '#3E6B3A' },
  { id: 'hav', label: 'Hav', page: '#EDF1F2', primary: '#2C7A8C' },
  { id: 'lavendel', label: 'Lavendel', page: '#F4F1F8', primary: '#6F5494' },
];
