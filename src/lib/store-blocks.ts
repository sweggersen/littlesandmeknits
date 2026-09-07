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
  | 'contactInfo';

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
  kind: 'text' | 'textarea' | 'boolean' | 'number' | 'assetId' | 'listingIds' | 'url';
  label: string;
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
}

export const BLOCK_REGISTRY: Record<StoreBlockType, BlockDef> = {
  hero: {
    type: 'hero',
    label: 'Toppseksjon',
    description: 'Logo, butikknavn og en kort undertittel, med valgfritt bannerbilde.',
    defaultProps: { showBanner: true, tagline: '', ctaText: '', ctaHref: '' },
    propSchema: [
      { key: 'tagline', kind: 'text', label: 'Undertittel' },
      { key: 'showBanner', kind: 'boolean', label: 'Vis banner' },
      { key: 'ctaText', kind: 'text', label: 'Knappetekst' },
      { key: 'ctaHref', kind: 'url', label: 'Knappelenke' },
    ],
    minW: 6, minH: 2, defaultW: 12, defaultH: 3,
  },
  productGrid: {
    type: 'productGrid',
    label: 'Produktrutenett',
    description: 'Alle aktive annonser fra butikken i et rutenett.',
    defaultProps: { heading: 'Annonser', limit: 24 },
    propSchema: [
      { key: 'heading', kind: 'text', label: 'Overskrift' },
      { key: 'limit', kind: 'number', label: 'Maks antall' },
    ],
    minW: 6, minH: 3, defaultW: 12, defaultH: 5,
  },
  featuredProducts: {
    type: 'featuredProducts',
    label: 'Utvalgte produkter',
    description: 'Et lite utvalg annonser du velger selv.',
    defaultProps: { heading: 'Utvalgte', ids: [] },
    propSchema: [
      { key: 'heading', kind: 'text', label: 'Overskrift' },
      { key: 'ids', kind: 'listingIds', label: 'Annonser' },
    ],
    minW: 4, minH: 3, defaultW: 8, defaultH: 4,
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
    minW: 4, minH: 2, defaultW: 8, defaultH: 3,
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
    minW: 6, minH: 2, defaultW: 12, defaultH: 3,
  },
  contactInfo: {
    type: 'contactInfo',
    label: 'Kontaktinfo',
    description: 'Sted, e-post og lenker til sosiale medier.',
    defaultProps: { heading: 'Kontakt' },
    propSchema: [{ key: 'heading', kind: 'text', label: 'Overskrift' }],
    minW: 4, minH: 2, defaultW: 4, defaultH: 3,
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
    h: clampInt(l.h, def.minH, 99, def.defaultH),
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
      props: { ...def.defaultProps, ...sanitizeProps(b.props) },
    });
  }
  return { blocks };
}

/** True when a store has a real, non-empty builder config. */
export function hasBuilderConfig(pageConfig: unknown): boolean {
  return sanitizePageConfig(pageConfig).blocks.length > 0;
}
