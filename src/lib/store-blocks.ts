// Store page-builder block registry + the page_config contract.
//
// A store page is `{ blocks: StoreBlock[] }`. Each block has a stable `id`, a
// `type` from the registry, a `layout` on a 12-column responsive grid, and a
// `props` bag (plain JSON). This shape is the CONTRACT between Phase 1 (this
// SSR renderer) and Phase 2 (the drag-drop editor): the editor only ever emits
// this JSON, and the renderer only ever trusts `sanitizePageConfig`'d output.
//
// Security: props are plain data and are always rendered as ESCAPED TEXT (never
// set:html) by the block components. Unknown block types are dropped on
// sanitise so a forged config can't invoke an arbitrary component.

/** The 12-column grid width. */
export const GRID_COLUMNS = 12;

export type StoreBlockType =
  | 'hero'
  | 'productGrid'
  | 'featuredProducts'
  | 'textSection'
  | 'imageBanner'
  | 'imageGallery'
  | 'contactInfo';

/** The bounded set of hero background-overlay styles. The overlay CSS is built
 *  ONLY from a clamped 0-100 number + one of these keys, never from a raw user
 *  string, so it is always inert inside an inline style attribute. */
export const HERO_OVERLAY_STYLES = ['none', 'solid', 'bottom', 'top', 'radial'] as const;
export type HeroOverlayStyle = (typeof HERO_OVERLAY_STYLES)[number];

/** Hard cap on images in an imageGallery block. Enforced in the editor, again in
 *  sanitizePageConfig, and a third time at render in ImageGallery.astro. */
export const MAX_GALLERY_IMAGES = 10;

export interface BlockLayout {
  x: number; // column offset 0..11 (advisory; renderer flows by y then x)
  y: number; // row order (>= 0)
  w: number; // column span 1..12
  h: number; // row span (>= 1), advisory for the editor
}

export interface StoreBlock<P = Record<string, unknown>> {
  id: string;
  type: StoreBlockType;
  layout: BlockLayout;
  props: P;
}

export interface StorePageConfig {
  blocks: StoreBlock[];
}

/** Minimal listing shape the product blocks render (fetched by the storefront,
 *  passed to blocks so they stay pure / do no I/O). */
export interface StorefrontListing {
  id: string;
  title: string;
  price_nok: number;
  hero_photo_path: string | null;
  size_label?: string | null;
  escrow_enabled?: boolean | null;
  can_meet?: boolean | null;
}

/** A store asset row, as passed to image blocks. */
export interface StorefrontAsset {
  id: string;
  path: string;
  kind: string | null;
  alt: string | null;
  position?: number;
}

/** A single prop's shape, for the Phase 2 property panel. */
export interface PropField {
  key: string;
  kind:
    | 'text'
    | 'textarea'
    | 'boolean'
    | 'number'
    | 'assetId'
    | 'assetIds'
    | 'listingIds'
    | 'url'
    | 'select';
  label: string;
  /** For the 'select' kind: the bounded set of choices the editor offers. The
   *  render/sanitise path independently re-validates against its own enum, so
   *  these are UI affordances, not the security boundary. */
  options?: { value: string; label: string }[];
  /** Placeholder for text/textarea/url inputs. The token `{store}` is replaced
   *  with the store's own name, so an empty field visibly defaults to it. */
  placeholder?: string;
}

export interface BlockDef {
  type: StoreBlockType;
  /** Norwegian-facing label (block palette). */
  label: string;
  /** Short Norwegian description. */
  description: string;
  defaultProps: Record<string, unknown>;
  /** Declarative prop schema the Phase 2 editor renders as a form. */
  propSchema: PropField[];
  /** Minimum grid span the editor should enforce. */
  minW: number;
  minH: number;
  /** Sensible default span when the block is first dropped. */
  defaultW: number;
  defaultH: number;
  /** Content-driven height: the block sizes to its content (a hero, a product
   *  grid that grows with listings), so the editor auto-fits it and offers only
   *  horizontal resize. Flexible blocks (text, contact, banner) are user-sized
   *  in both directions. */
  contentHeight?: boolean;
}

export const BLOCK_REGISTRY: Record<StoreBlockType, BlockDef> = {
  hero: {
    type: 'hero',
    contentHeight: true,
    label: 'Toppseksjon',
    description: 'Logo, butikknavn og en kort undertittel, over et valgfritt bakgrunnsbilde.',
    defaultProps: {
      showBanner: true,
      tagline: '',
      ctaText: '',
      ctaHref: '',
      logo: '',
      bgImage: '',
      overlay: 45,
      overlayStyle: 'bottom',
    },
    propSchema: [
      { key: 'title', kind: 'text', label: 'Butikknavn' },
      { key: 'tagline', kind: 'text', label: 'Undertittel' },
      { key: 'logo', kind: 'assetId', label: 'Logo' },
      { key: 'bgImage', kind: 'assetId', label: 'Bakgrunnsbilde' },
      { key: 'overlay', kind: 'number', label: 'Mørkt overlegg (0–100)' },
      {
        key: 'overlayStyle',
        kind: 'select',
        label: 'Overleggsstil',
        options: [
          { value: 'bottom', label: 'Mørkere nederst' },
          { value: 'top', label: 'Mørkere øverst' },
          { value: 'radial', label: 'Mørkere i kantene' },
          { value: 'solid', label: 'Heldekkende' },
          { value: 'none', label: 'Ingen' },
        ],
      },
      { key: 'showBanner', kind: 'boolean', label: 'Vis banner' },
      { key: 'ctaText', kind: 'text', label: 'Knappetekst' },
      { key: 'ctaHref', kind: 'url', label: 'Knappelenke' },
    ],
    minW: 6, minH: 60, defaultW: 12, defaultH: 220,
  },
  productGrid: {
    type: 'productGrid',
    contentHeight: true,
    label: 'Produktrutenett',
    description: 'Alle aktive annonser fra butikken i et rutenett.',
    defaultProps: { heading: 'Annonser', limit: 24 },
    propSchema: [
      { key: 'heading', kind: 'text', label: 'Overskrift' },
      { key: 'limit', kind: 'number', label: 'Maks antall' },
    ],
    minW: 6, minH: 60, defaultW: 12, defaultH: 240,
  },
  featuredProducts: {
    type: 'featuredProducts',
    contentHeight: true,
    label: 'Utvalgte produkter',
    description: 'Et lite utvalg annonser du velger selv.',
    defaultProps: { heading: 'Utvalgte', ids: [] },
    propSchema: [
      { key: 'heading', kind: 'text', label: 'Overskrift' },
      { key: 'ids', kind: 'listingIds', label: 'Annonser' },
    ],
    minW: 4, minH: 60, defaultW: 8, defaultH: 140,
  },
  textSection: {
    type: 'textSection',
    label: 'Tekstseksjon',
    description: 'En overskrift og en tekstblokk, for eksempel «Om butikken».',
    defaultProps: { heading: 'Om oss', body: '' },
    propSchema: [
      { key: 'heading', kind: 'text', label: 'Overskrift' },
      { key: 'body', kind: 'textarea', label: 'Tekst' },
    ],
    minW: 4, minH: 100, defaultW: 8, defaultH: 150,
  },
  imageBanner: {
    type: 'imageBanner',
    label: 'Bildebanner',
    description: 'Et opplastet butikkbilde i full bredde.',
    defaultProps: { assetId: '', alt: '', height: 320 },
    propSchema: [
      { key: 'assetId', kind: 'assetId', label: 'Bilde' },
      { key: 'alt', kind: 'text', label: 'Alt-tekst' },
      { key: 'height', kind: 'number', label: 'Høyde (px)' },
    ],
    minW: 6, minH: 100, defaultW: 12, defaultH: 180,
  },
  imageGallery: {
    type: 'imageGallery',
    contentHeight: true,
    label: 'Bildegalleri',
    description: 'Opptil ti opplastede bilder i kvadratiske miniatyrer som åpnes i en bildekarusell.',
    defaultProps: { heading: 'Galleri', images: [] },
    propSchema: [
      { key: 'heading', kind: 'text', label: 'Overskrift' },
      { key: 'images', kind: 'assetIds', label: 'Bilder (maks 10)' },
    ],
    minW: 4, minH: 60, defaultW: 12, defaultH: 200,
  },
  contactInfo: {
    type: 'contactInfo',
    label: 'Kontaktinfo',
    description: 'Sted, e-post og lenker til sosiale medier.',
    defaultProps: { heading: 'Kontakt' },
    propSchema: [{ key: 'heading', kind: 'text', label: 'Overskrift' }],
    minW: 4, minH: 100, defaultW: 4, defaultH: 140,
  },
};

export const STORE_BLOCK_TYPES = Object.keys(BLOCK_REGISTRY) as StoreBlockType[];

export function isKnownBlockType(type: unknown): type is StoreBlockType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(BLOCK_REGISTRY, type);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Coerce any layout-ish value into a valid 12-col grid layout. */
export function sanitizeLayout(input: unknown, def: BlockDef): BlockLayout {
  const l = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const w = clampInt(l.w, def.minW, GRID_COLUMNS, def.defaultW);
  const x = clampInt(l.x, 0, GRID_COLUMNS - 1, 0);
  return {
    w,
    // x + w must not overflow the grid.
    x: Math.min(x, GRID_COLUMNS - w),
    y: clampInt(l.y, 0, 9999, 0),
    // h is a pixel row count (the editor grid uses a 1px row unit).
    h: clampInt(l.h, def.minH, 6000, def.defaultH),
  };
}

// Props are plain JSON. We accept any JSON-serialisable object but strip
// anything that isn't (functions, symbols) by shallow-copying scalar/array/
// object values. Per-field validation (escaping, id existence) happens at
// RENDER time in the block components, which is the security boundary.
function sanitizeProps(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === null) { out[k] = null; continue; }
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x) => ['string', 'number', 'boolean'].includes(typeof x));
    else if (t === 'object') out[k] = sanitizeProps(v); // shallow nested objects
  }
  return out;
}

/** Coerce any value into one of the bounded overlay styles. */
export function coerceOverlayStyle(value: unknown): HeroOverlayStyle {
  return typeof value === 'string' && (HERO_OVERLAY_STYLES as readonly string[]).includes(value)
    ? (value as HeroOverlayStyle)
    : 'bottom';
}

/** De-dupe + cap an assetIds-style array to strings, at most `max` entries. */
export function capAssetIds(value: unknown, max = MAX_GALLERY_IMAGES): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || v.length === 0 || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Build a safe CSS background value for the hero overlay from ONLY a clamped
 * 0-100 strength + a bounded style key. The output contains nothing but digits,
 * dots, commas, parentheses and hard-coded CSS keywords, so it is always inert
 * inside an inline `style` attribute. No user string is ever concatenated in.
 */
export function heroOverlayCss(strength: unknown, style: HeroOverlayStyle): string {
  const s = clampInt(strength, 0, 100, 45);
  if (s === 0 || style === 'none') return 'transparent';
  const hi = (s / 100).toFixed(3);
  const lo = ((s / 100) * 0.35).toFixed(3);
  switch (style) {
    case 'solid':
      return `rgba(0,0,0,${hi})`;
    case 'top':
      return `linear-gradient(0deg, rgba(0,0,0,${lo}), rgba(0,0,0,${hi}))`;
    case 'radial':
      return `radial-gradient(ellipse at center, rgba(0,0,0,${lo}), rgba(0,0,0,${hi}))`;
    case 'bottom':
    default:
      return `linear-gradient(180deg, rgba(0,0,0,${lo}), rgba(0,0,0,${hi}))`;
  }
}

/**
 * Apply per-block-type SEMANTIC clamping on top of the generic structural
 * sanitiser: hero overlay strength -> 0-100 int, overlay style -> bounded enum,
 * gallery images -> at most MAX_GALLERY_IMAGES unique strings. Runs on props
 * that already have the block defaults merged in, so every key is present.
 */
function sanitizeBlockProps(type: StoreBlockType, props: Record<string, unknown>): Record<string, unknown> {
  const out = { ...props };
  if (type === 'hero') {
    out.overlay = clampInt(out.overlay, 0, 100, 45);
    out.overlayStyle = coerceOverlayStyle(out.overlayStyle);
    // Defensive cap: the title renders as a large H1, never a paragraph.
    if (typeof out.title === 'string') out.title = out.title.slice(0, 80);
  } else if (type === 'imageGallery') {
    out.images = capAssetIds(out.images);
  }
  return out;
}

let autoId = 0;
function ensureId(raw: unknown): string {
  if (typeof raw === 'string' && raw.length > 0 && raw.length <= 64) return raw;
  return `blk-${Date.now().toString(36)}-${(autoId++).toString(36)}`;
}

/**
 * Validate arbitrary page_config JSON into a safe StorePageConfig. Unknown
 * block types are DROPPED. Props are merged over the block's defaults so a
 * partial config still renders. Layout is clamped to the grid. Safe to render.
 */
export function sanitizePageConfig(input: unknown): StorePageConfig {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const rawBlocks = Array.isArray(obj.blocks) ? obj.blocks : [];
  const blocks: StoreBlock[] = [];
  for (const rb of rawBlocks) {
    if (!rb || typeof rb !== 'object') continue;
    const b = rb as Record<string, unknown>;
    if (!isKnownBlockType(b.type)) continue; // drop unknown types
    const def = BLOCK_REGISTRY[b.type];
    blocks.push({
      id: ensureId(b.id),
      type: b.type,
      layout: sanitizeLayout(b.layout, def),
      props: sanitizeBlockProps(b.type, { ...def.defaultProps, ...sanitizeProps(b.props) }),
    });
  }
  return { blocks };
}

/** True when a store has a real, non-empty builder config. */
export function hasBuilderConfig(pageConfig: unknown): boolean {
  return sanitizePageConfig(pageConfig).blocks.length > 0;
}
