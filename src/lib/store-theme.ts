// Store theming model + sanitiser.
//
// A store theme is a small, BOUNDED set of colour roles + two font picks. The
// sanitised output is turned into a `--color-*: …` string that gets injected
// into an inline `style` attribute on the storefront container
// (`storeThemeToCssVars`). Because that value lands in CSS, injection safety is
// paramount: EVERY colour is validated against a strict hex regex, and every
// font is mapped from a KNOWN id to a hard-coded family string. Nothing the
// user typed is ever concatenated into the output verbatim, so a value like
// `red;} body{display:none` or `url(javascript:…)` can never escape.
//
// Phase 2 (the editor) writes this same JSON shape; keep it stable.

export type StoreFontRole = 'display' | 'body' | 'both';

export interface StoreFont {
  id: string;
  /** Norwegian-facing label for the picker. */
  label: string;
  /** Hard-coded CSS font-family stack. Self-hosted via @fontsource (no CDN). */
  family: string;
  role: StoreFontRole;
}

// Curated, self-hosted font set. Each family is imported in
// `src/styles/global.css` via @fontsource-variable so it is available on the
// storefront with NO external request (CSP forbids CDNs).
export const STORE_FONTS: readonly StoreFont[] = [
  { id: 'fraunces', label: 'Fraunces', family: '"Fraunces Variable", ui-serif, Georgia, serif', role: 'display' },
  { id: 'playfair', label: 'Playfair Display', family: '"Playfair Display Variable", ui-serif, Georgia, serif', role: 'display' },
  { id: 'space-grotesk', label: 'Space Grotesk', family: '"Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif', role: 'both' },
  { id: 'inter', label: 'Inter', family: '"Inter Variable", ui-sans-serif, system-ui, sans-serif', role: 'body' },
  { id: 'dm-sans', label: 'DM Sans', family: '"DM Sans Variable", ui-sans-serif, system-ui, sans-serif', role: 'body' },
] as const;

const FONT_BY_ID = new Map(STORE_FONTS.map((f) => [f.id, f]));

/** The bounded set of themeable colour roles. */
export const STORE_COLOR_ROLES = [
  'page', // page background
  'surface', // card / panel background
  'text', // primary ink
  'muted', // secondary text
  'border', // hairline borders
  'primary', // primary action / accent-strong
  'primaryFg', // text on primary
  'accent', // secondary accent
  'headerBg', // hero / header band background
] as const;
export type StoreColorRole = (typeof STORE_COLOR_ROLES)[number];

export interface StoreTheme {
  colors: Record<StoreColorRole, string>;
  /** A known font id (display role). */
  fontDisplay: string;
  /** A known font id (body role). */
  fontBody: string;
}

export const DEFAULT_STORE_THEME: StoreTheme = {
  colors: {
    page: '#FAF6F0',
    surface: '#FFFFFF',
    text: '#2C2A26',
    muted: '#6E6A63',
    border: '#E8DFD0',
    primary: '#C76D4E',
    primaryFg: '#FAF6F0',
    accent: '#9CAF88',
    headerBg: '#2C2A26',
  },
  fontDisplay: 'fraunces',
  fontBody: 'inter',
};

// Strict: `#rgb` or `#rrggbb` only. No `rgb()`, no named colours, no url(),
// no semicolons — so a validated value is always inert inside a CSS declaration.
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHex(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

export function isKnownFont(id: unknown): id is string {
  return typeof id === 'string' && FONT_BY_ID.has(id);
}

function sanitizeHex(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (HEX_RE.test(trimmed)) return trimmed.toUpperCase();
  }
  return fallback;
}

function sanitizeFontId(value: unknown, fallback: string): string {
  return isKnownFont(value) ? value : fallback;
}

/**
 * Whitelist + validate arbitrary input into a safe StoreTheme. Unknown keys are
 * dropped, bad hex is replaced with the default for that role, unknown font ids
 * fall back to the default font. The result is always complete and safe to feed
 * to `storeThemeToCssVars`.
 */
export function sanitizeStoreTheme(input: unknown): StoreTheme {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const inColors =
    obj.colors && typeof obj.colors === 'object' ? (obj.colors as Record<string, unknown>) : {};

  const colors = {} as Record<StoreColorRole, string>;
  for (const role of STORE_COLOR_ROLES) {
    colors[role] = sanitizeHex(inColors[role], DEFAULT_STORE_THEME.colors[role]);
  }

  return {
    colors,
    fontDisplay: sanitizeFontId(obj.fontDisplay, DEFAULT_STORE_THEME.fontDisplay),
    fontBody: sanitizeFontId(obj.fontBody, DEFAULT_STORE_THEME.fontBody),
  };
}

/** Resolve a validated font id to its hard-coded family stack. */
export function fontFamily(id: string): string {
  return (FONT_BY_ID.get(id) ?? FONT_BY_ID.get(DEFAULT_STORE_THEME.fontDisplay)!).family;
}

// Map each colour role to the CSS custom property it drives. We deliberately
// override the SAME semantic tokens the shared marketplace components already
// resolve (`--color-surface`, `--color-primary`, `--color-charcoal`,
// `--color-sage-500` for card borders) so ListingCard etc. reskin inside the
// store scope with no component edits, plus a few `--store-*` tokens the block
// CSS references directly.
function colorVarPairs(colors: Record<StoreColorRole, string>): string[] {
  return [
    `--color-page:${colors.page}`,
    `--color-linen:${colors.page}`,
    `--color-surface:${colors.surface}`,
    `--color-charcoal:${colors.text}`,
    `--store-muted:${colors.muted}`,
    `--store-border:${colors.border}`,
    // Card borders in shared components use border-sage-500/… — retint it.
    `--color-sage-500:${colors.border}`,
    `--color-primary:${colors.primary}`,
    `--color-primary-hover:${colors.primary}`,
    `--color-primary-fg:${colors.primaryFg}`,
    `--store-accent:${colors.accent}`,
    `--store-header-bg:${colors.headerBg}`,
  ];
}

/**
 * Build a safe `--token:value;…` string for an inline style attribute. The
 * input is re-sanitised defensively, so even a raw DB row (which may predate a
 * schema change or have been written directly) can never emit an unsafe value.
 */
export function storeThemeToCssVars(theme: unknown): string {
  const t = sanitizeStoreTheme(theme);
  const parts = colorVarPairs(t.colors);
  const display = fontFamily(t.fontDisplay);
  const body = fontFamily(t.fontBody);
  // Font families come only from our hard-coded map — never user input.
  parts.push(`--font-display:${display}`);
  parts.push(`--font-serif:${display}`);
  parts.push(`--font-body:${body}`);
  parts.push(`--font-sans:${body}`);
  return parts.join(';') + ';';
}
