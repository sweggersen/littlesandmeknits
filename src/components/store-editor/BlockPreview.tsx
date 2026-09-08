// Schematic, themed preview of one block, drawn on the editor canvas. It is NOT
// the real SSR renderer (that runs on the storefront + draft preview) — just a
// quick, recognisable sketch so the owner sees structure + theme while editing.
// All colours/fonts come from the CSS vars the canvas sets via
// storeThemeToCssVars, so it reflects the live theme automatically.
import { useRef, useState, type CSSProperties, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import type { StoreBlock, HeroElementKey, HeroElementPos } from '../../lib/store-blocks';
import {
  heroOverlayCss,
  coerceOverlayStyle,
  MAX_GALLERY_IMAGES,
  sanitizeHeroElements,
  clampInt,
  HERO_DEFAULT_ELEMENTS,
  HERO_LOGO_SCALE_MIN,
  HERO_LOGO_SCALE_MAX,
  HERO_LOGO_SCALE_DEFAULT,
  HERO_LOGO_TINT_MIN,
  HERO_LOGO_TINT_MAX,
  HERO_LOGO_TINT_DEFAULT,
} from '../../lib/store-blocks';
import { projectPhotoUrl } from '../../lib/storage';
import { STORE_EDITOR_LABELS as L } from '../../lib/labels';
import type { EditorAsset } from './types';

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

// Heading style for the schematic previews. Colour/weight/italic/underline come
// from the live theme CSS vars the canvas sets, and the size is the block's own
// base scaled by --store-heading-scale — matching the real SSR blocks. Pass
// `contrast` for headings that sit on the dark hero band (they keep white).
function headingStyle(baseRem: string, contrast = false): CSSProperties {
  return {
    fontFamily: 'var(--font-display)',
    ...(contrast ? {} : { color: 'var(--store-heading)' }),
    fontWeight: 'var(--store-heading-weight)',
    fontStyle: 'var(--store-heading-style)',
    textDecoration: 'var(--store-heading-decoration)',
    fontSize: `calc(${baseRem} * var(--store-heading-scale))`,
  } as CSSProperties;
}

// data-hook the canvas listens on to open the click-to-edit popover. The value
// is the element KIND, so one handler routes every element to the right controls.
const HEAD_EDIT = { 'data-elem-edit': 'heading' } as const;
const elemEdit = (kind: 'text' | 'tag' | 'header' | 'logo') => ({ 'data-elem-edit': kind });

export default function BlockPreview({
  block,
  storeName,
  storeLogoUrl,
  assets,
  onUpdateProps,
  suppressElementClickRef,
}: {
  block: StoreBlock;
  storeName: string;
  storeLogoUrl?: string | null;
  assets: EditorAsset[];
  /** Commit a props patch for THIS block (used by the hero free-layout drag).
   *  Absent = static preview (no interaction). */
  onUpdateProps?: (id: string, patch: Record<string, unknown>) => void;
  /** Shared flag the canvas checks so a drag doesn't also open the heading
   *  popover on the trailing click. */
  suppressElementClickRef?: MutableRefObject<boolean>;
}) {
  const p = block.props as Record<string, unknown>;

  switch (block.type) {
    case 'hero':
      return (
        <HeroPreview
          block={block}
          storeName={storeName}
          storeLogoUrl={storeLogoUrl}
          assets={assets}
          onUpdateProps={onUpdateProps}
          suppressElementClickRef={suppressElementClickRef}
        />
      );

    case 'textSection':
      return (
        <div>
          <div {...HEAD_EDIT} style={headingStyle('0.875rem')}>
            {str(p.heading, 'Tekstseksjon')}
          </div>
          <p {...elemEdit('text')} className="text-xs mt-1 line-clamp-3" style={{ color: 'var(--color-charcoal)' }}>
            {str(p.body, 'Tekstinnhold vises her.')}
          </p>
        </div>
      );

    case 'productGrid':
      return (
        <div>
          <div {...HEAD_EDIT} className="mb-2" style={headingStyle('0.875rem')}>
            {str(p.heading, 'Annonser')}
          </div>
          {/* A short EXAMPLE row — the live grid grows with the store's actual
              listings on the storefront; the editor just represents it. */}
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded flex flex-col items-center justify-center gap-1 text-[10px]"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--store-border)', color: 'var(--store-muted)' }}
              >
                <span>Produkt</span>
                {/* Mini preview of the themeable "Merkelapp" (tag) colour with its
                    auto-contrasted text, so the owner sees it in context. */}
                <span
                  {...elemEdit('tag')}
                  className="text-[8px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                  style={{ background: 'var(--store-tag)', color: 'var(--store-tag-fg)' }}
                >
                  Sendes
                </span>
              </div>
            ))}
          </div>
          <div className="text-[10px] opacity-55 mt-1.5">Alle aktive annonser vises her (maks {Number(p.limit) || 24}).</div>
        </div>
      );

    case 'featuredProducts': {
      const ids = Array.isArray(p.ids) ? p.ids : [];
      return (
        <div>
          <div {...HEAD_EDIT} className="mb-1" style={headingStyle('0.875rem')}>
            {str(p.heading, 'Utvalgte')}
          </div>
          <div className="text-xs opacity-65">{ids.length} valgte produkter</div>
        </div>
      );
    }

    case 'imageBanner': {
      const asset = assets.find((a) => a.id === str(p.assetId));
      const url = asset ? projectPhotoUrl(asset.path) : null;
      return url ? (
        <img src={url} alt={str(p.alt)} className="w-full rounded-lg object-cover" style={{ maxHeight: 120 }} />
      ) : (
        <div
          className="rounded-lg flex items-center justify-center text-xs opacity-60"
          style={{ height: 90, background: 'var(--color-surface)', border: '1px dashed var(--store-border)' }}
        >
          Bildebanner
        </div>
      );
    }

    case 'imageGallery': {
      const ids = (Array.isArray(p.images) ? p.images : []).filter(
        (x): x is string => typeof x === 'string',
      );
      const picked = ids
        .map((id) => assets.find((a) => a.id === id))
        .filter((a): a is EditorAsset => Boolean(a))
        .slice(0, MAX_GALLERY_IMAGES);
      return (
        <div>
          {str(p.heading) && (
            <div {...HEAD_EDIT} className="mb-2" style={headingStyle('0.875rem')}>
              {str(p.heading)}
            </div>
          )}
          {picked.length > 0 ? (
            <div className="grid grid-cols-4 gap-1.5">
              {picked.map((a) => (
                <img
                  key={a.id}
                  src={projectPhotoUrl(a.path) ?? ''}
                  alt={a.alt ?? ''}
                  className="aspect-square w-full rounded object-cover"
                  style={{ border: '1px solid var(--store-border)' }}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square rounded"
                  style={{ background: 'var(--color-surface)', border: '1px dashed var(--store-border)' }}
                />
              ))}
            </div>
          )}
          <div className="text-[10px] opacity-55 mt-1.5">Bildegalleri (maks {MAX_GALLERY_IMAGES})</div>
        </div>
      );
    }

    case 'contactInfo':
      return (
        <div>
          <div {...HEAD_EDIT} className="mb-1" style={headingStyle('0.875rem')}>
            {str(p.heading, 'Kontakt')}
          </div>
          <div {...elemEdit('text')} className="text-xs opacity-65 space-y-0.5">
            <div>Sted, e-post</div>
            <div>Sosiale medier</div>
          </div>
        </div>
      );

    case 'team':
      return (
        <div>
          <div {...HEAD_EDIT} className="mb-2" style={headingStyle('0.875rem')}>
            {str(p.heading, 'Eier / team')}
          </div>
          {/* The live block shows the store's real members; the editor draws a
              representative sketch, like productGrid's example tiles. */}
          <div className="flex gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 min-w-0">
                <div
                  className="w-8 h-8 rounded-full shrink-0"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--store-border)' }}
                />
                <div className="min-w-0">
                  <div className="text-[11px] font-medium truncate" style={{ color: 'var(--color-charcoal)' }}>Navn</div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--store-muted)' }}>Tittel</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    default:
      return <div className="text-xs opacity-60">{block.type}</div>;
  }
}

// ── Hero free-layout preview ────────────────────────────────────────────────
// Renders the hero's logo/title/subtitle/cta as individually draggable elements,
// absolutely positioned by percent inside the preview box. A plain click on the
// title still opens the heading-style popover (via HEAD_EDIT); a click-DRAG
// (past a small threshold) moves the element instead and suppresses that click.
// The logo carries a corner handle that resizes it. Commits as ONE props patch
// (one undo step per gesture). Positions snap to a SQUARE pixel grid (so the
// visible grid cells are actually square, not stretched by the box aspect), with
// a stronger pull to the exact centre; scale still snaps to a 5% step.
const SNAP = 5;
const DRAG_THRESHOLD = 4;
const GRID_PX = 24; // square snap-grid cell size, in px
const CENTER_PX = 14; // pull-to-centre threshold, in px
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
// Snap one axis (a px offset within a `size`-px box) to the grid, or to the
// exact centre when close. Returns a px offset.
function snapAxisPx(offset: number, size: number): number {
  const centre = size / 2;
  if (Math.abs(offset - centre) <= CENTER_PX) return centre;
  return Math.round(offset / GRID_PX) * GRID_PX;
}

function HeroPreview({
  block,
  storeName,
  storeLogoUrl,
  assets,
  onUpdateProps,
  suppressElementClickRef,
}: {
  block: StoreBlock;
  storeName: string;
  storeLogoUrl?: string | null;
  assets: EditorAsset[];
  onUpdateProps?: (id: string, patch: Record<string, unknown>) => void;
  suppressElementClickRef?: MutableRefObject<boolean>;
}) {
  const p = block.props as Record<string, unknown>;
  const bgAsset = assets.find((a) => a.id === str(p.bgImage));
  const bgUrl = bgAsset ? projectPhotoUrl(bgAsset.path) : null;
  const logoAsset = assets.find((a) => a.id === str(p.logo));
  // Fall back to the store's own logo (like the storefront) so the logo shows
  // in the preview even when no builder asset is chosen -- otherwise the tint /
  // size controls appear to do nothing.
  const logoUrl = logoAsset ? projectPhotoUrl(logoAsset.path) : (storeLogoUrl ?? null);
  const overlay = heroOverlayCss(p.overlay, coerceOverlayStyle(p.overlayStyle));
  // Logo tint: a grayscale filter built ONLY from a clamped integer, mirroring
  // the storefront (StoreHero.astro). Never concatenates a raw prop into CSS.
  const logoTint = clampInt(p.logoTint, HERO_LOGO_TINT_MIN, HERO_LOGO_TINT_MAX, HERO_LOGO_TINT_DEFAULT);
  const logoFilter = logoTint > 0 ? `grayscale(${logoTint}%)` : undefined;
  const title = p.title === undefined ? storeName : String(p.title).trim();
  const tagline = str(p.tagline);
  const ctaText = str(p.ctaText);

  const boxRef = useRef<HTMLDivElement>(null);
  const [showGrid, setShowGrid] = useState(false);
  // The element currently being dragged/resized, with its live (unsnapped) pos.
  const [active, setActive] = useState<{ key: HeroElementKey; pos: HeroElementPos } | null>(null);

  const stored = sanitizeHeroElements(p.elements) ?? {};
  const interactive = typeof onUpdateProps === 'function';

  function posOf(key: HeroElementKey): HeroElementPos {
    if (active?.key === key) return active.pos;
    return stored[key] ?? HERO_DEFAULT_ELEMENTS[key];
  }

  function commit(key: HeroElementKey, pos: HeroElementPos) {
    if (!onUpdateProps) return;
    // Merge into whatever is already stored; only the moved element is written,
    // so untouched elements keep their default centred-stack position.
    onUpdateProps(block.id, { elements: { ...stored, [key]: pos } });
  }

  // Snap a client point to the square grid / centre, as bounded x/y percents.
  function snapPos(clientX: number, clientY: number, box: DOMRect, orig: HeroElementPos) {
    return {
      x: clampInt((snapAxisPx(clientX - box.left, box.width) / box.width) * 100, 0, 100, orig.x),
      y: clampInt((snapAxisPx(clientY - box.top, box.height) / box.height) * 100, 0, 100, orig.y),
    };
  }

  function startMove(key: HeroElementKey, e: ReactPointerEvent) {
    if (!interactive || e.button !== 0) return;
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const orig = posOf(key);
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      moved = true;
      ev.preventDefault();
      setShowGrid(true);
      // Snap live so the element visibly locks to the grid / centre while dragging.
      setActive({ key, pos: { ...orig, ...snapPos(ev.clientX, ev.clientY, box, orig) } });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setShowGrid(false);
      setActive(null);
      if (!moved) return;
      // Suppress the trailing click so it doesn't open the heading popover.
      if (suppressElementClickRef) suppressElementClickRef.current = true;
      commit(key, { ...orig, ...snapPos(ev.clientX, ev.clientY, box, orig) });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function startResize(e: ReactPointerEvent) {
    if (!interactive || e.button !== 0) return;
    e.stopPropagation(); // don't also start a move on the logo wrapper
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const logo = posOf('logo');
    const centerX = box.left + (logo.x / 100) * box.width;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const scaleFrom = (clientX: number) =>
      clampInt(
        (Math.abs(clientX - centerX) * 2 / box.width) * 100,
        HERO_LOGO_SCALE_MIN,
        HERO_LOGO_SCALE_MAX,
        logo.scale ?? HERO_LOGO_SCALE_DEFAULT,
      );
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      moved = true;
      ev.preventDefault();
      setShowGrid(true);
      setActive({ key: 'logo', pos: { ...logo, scale: scaleFrom(ev.clientX) } });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setShowGrid(false);
      setActive(null);
      if (!moved) return;
      if (suppressElementClickRef) suppressElementClickRef.current = true;
      const snapped = clampInt(snap(scaleFrom(ev.clientX)), HERO_LOGO_SCALE_MIN, HERO_LOGO_SCALE_MAX, logo.scale ?? HERO_LOGO_SCALE_DEFAULT);
      commit('logo', { ...logo, scale: snapped });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function elStyle(key: HeroElementKey, extra?: CSSProperties): CSSProperties {
    const pos = posOf(key);
    const base: CSSProperties = {
      position: 'absolute',
      left: `${pos.x}%`,
      top: `${pos.y}%`,
      transform: 'translate(-50%, -50%)',
      maxWidth: '90%',
      cursor: interactive ? 'grab' : undefined,
      touchAction: 'none',
      ...extra,
    };
    if (key === 'logo') base.width = `${pos.scale ?? HERO_LOGO_SCALE_DEFAULT}%`;
    return base;
  }

  return (
    <div
      ref={boxRef}
      className="relative overflow-hidden rounded-xl text-white"
      style={{ background: 'var(--store-header-bg)', minHeight: 190 }}
      data-hero-layout
      {...elemEdit('header')}
    >
      {bgUrl && <img src={bgUrl} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" />}
      {overlay !== 'transparent' && <div className="absolute inset-0" style={{ background: overlay }} />}

      {/* Snap-grid overlay, visible only mid-drag: a SQUARE px grid plus red
          centre lines (x and y) that the element snaps to. */}
      {showGrid && (
        <div className="absolute inset-0 pointer-events-none" data-hero-grid>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.35) 1px, transparent 1px)',
              backgroundSize: `${GRID_PX}px ${GRID_PX}px`,
            }}
          />
          {/* Vertical + horizontal centre guides. */}
          <div className="absolute top-0 bottom-0" style={{ left: '50%', width: 0, borderLeft: '1px solid rgba(239,68,68,.85)', transform: 'translateX(-.5px)' }} />
          <div className="absolute left-0 right-0" style={{ top: '50%', height: 0, borderTop: '1px solid rgba(239,68,68,.85)', transform: 'translateY(-.5px)' }} />
        </div>
      )}

      {logoUrl && (
        <div
          style={elStyle('logo')}
          onPointerDown={(e) => startMove('logo', e)}
          data-hero-el="logo"
          {...elemEdit('logo')}
        >
          <img src={logoUrl} alt="" style={logoFilter ? { filter: logoFilter } : undefined} className="w-full h-auto object-contain drop-shadow pointer-events-none select-none" draggable={false} />
          {interactive && (
            <span
              onPointerDown={startResize}
              title={L.resizeLogo}
              aria-label={L.resizeLogo}
              className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-full border border-white bg-[var(--color-primary)] cursor-nwse-resize"
              data-hero-resize
            />
          )}
        </div>
      )}

      {title && (
        <div
          {...HEAD_EDIT}
          style={elStyle('title', headingStyle('1.125rem', true))}
          onPointerDown={(e) => startMove('title', e)}
          data-hero-el="title"
        >
          {title}
        </div>
      )}

      {tagline && (
        <div
          className="text-xs opacity-80"
          style={elStyle('subtitle')}
          onPointerDown={(e) => startMove('subtitle', e)}
          data-hero-el="subtitle"
        >
          {tagline}
        </div>
      )}

      {ctaText && (
        <span
          className="inline-block text-[11px] px-3 py-1 rounded-full whitespace-nowrap"
          style={elStyle('cta', { background: 'var(--color-primary)', color: 'var(--color-primary-fg)' })}
          onPointerDown={(e) => startMove('cta', e)}
          data-hero-el="cta"
        >
          {ctaText}
        </span>
      )}
    </div>
  );
}
