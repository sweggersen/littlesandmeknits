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

// data-hook the canvas listens on to open the click-to-edit heading popover.
const HEAD_EDIT = { 'data-heading-edit': '' } as const;

export default function BlockPreview({
  block,
  storeName,
  assets,
  onUpdateProps,
  suppressHeadingClickRef,
}: {
  block: StoreBlock;
  storeName: string;
  assets: EditorAsset[];
  /** Commit a props patch for THIS block (used by the hero free-layout drag).
   *  Absent = static preview (no interaction). */
  onUpdateProps?: (id: string, patch: Record<string, unknown>) => void;
  /** Shared flag the canvas checks so a drag doesn't also open the heading
   *  popover on the trailing click. */
  suppressHeadingClickRef?: MutableRefObject<boolean>;
}) {
  const p = block.props as Record<string, unknown>;

  switch (block.type) {
    case 'hero':
      return (
        <HeroPreview
          block={block}
          storeName={storeName}
          assets={assets}
          onUpdateProps={onUpdateProps}
          suppressHeadingClickRef={suppressHeadingClickRef}
        />
      );

    case 'textSection':
      return (
        <div>
          <div {...HEAD_EDIT} style={headingStyle('0.875rem')}>
            {str(p.heading, 'Tekstseksjon')}
          </div>
          <p className="text-xs mt-1 line-clamp-3" style={{ color: 'var(--color-charcoal)' }}>
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
                className="h-16 rounded flex items-center justify-center text-[10px]"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--store-border)', color: 'var(--store-muted)' }}
              >
                Produkt
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
          <div className="text-xs opacity-65 space-y-0.5">
            <div>Sted, e-post</div>
            <div>Sosiale medier</div>
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
// The logo carries a corner handle that resizes it. Positions snap to a 5% grid
// on release and commit as ONE props patch (one undo step per gesture).
const SNAP = 5;
const DRAG_THRESHOLD = 4;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

function HeroPreview({
  block,
  storeName,
  assets,
  onUpdateProps,
  suppressHeadingClickRef,
}: {
  block: StoreBlock;
  storeName: string;
  assets: EditorAsset[];
  onUpdateProps?: (id: string, patch: Record<string, unknown>) => void;
  suppressHeadingClickRef?: MutableRefObject<boolean>;
}) {
  const p = block.props as Record<string, unknown>;
  const bgAsset = assets.find((a) => a.id === str(p.bgImage));
  const bgUrl = bgAsset ? projectPhotoUrl(bgAsset.path) : null;
  const logoAsset = assets.find((a) => a.id === str(p.logo));
  const logoUrl = logoAsset ? projectPhotoUrl(logoAsset.path) : null;
  const overlay = heroOverlayCss(p.overlay, coerceOverlayStyle(p.overlayStyle));
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

  // Percent-of-box from a client coordinate, clamped to a bounded integer.
  function pctX(clientX: number, box: DOMRect, fallback: number) {
    return clampInt(((clientX - box.left) / box.width) * 100, 0, 100, fallback);
  }
  function pctY(clientY: number, box: DOMRect, fallback: number) {
    return clampInt(((clientY - box.top) / box.height) * 100, 0, 100, fallback);
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
      setActive({ key, pos: { ...orig, x: pctX(ev.clientX, box, orig.x), y: pctY(ev.clientY, box, orig.y) } });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setShowGrid(false);
      setActive(null);
      if (!moved) return;
      // Suppress the trailing click so it doesn't open the heading popover.
      if (suppressHeadingClickRef) suppressHeadingClickRef.current = true;
      commit(key, {
        ...orig,
        x: clampInt(snap(pctX(ev.clientX, box, orig.x)), 0, 100, orig.x),
        y: clampInt(snap(pctY(ev.clientY, box, orig.y)), 0, 100, orig.y),
      });
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
      if (suppressHeadingClickRef) suppressHeadingClickRef.current = true;
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
    >
      {bgUrl && <img src={bgUrl} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" />}
      {overlay !== 'transparent' && <div className="absolute inset-0" style={{ background: overlay }} />}

      {/* Snap-grid overlay, visible only mid-drag. */}
      {showGrid && (
        <div
          className="absolute inset-0 pointer-events-none"
          data-hero-grid
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.35) 1px, transparent 1px)',
            backgroundSize: '5% 5%',
          }}
        />
      )}

      {logoUrl && (
        <div
          style={elStyle('logo')}
          onPointerDown={(e) => startMove('logo', e)}
          data-hero-el="logo"
        >
          <img src={logoUrl} alt="" className="w-full h-auto object-contain drop-shadow pointer-events-none select-none" draggable={false} />
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
