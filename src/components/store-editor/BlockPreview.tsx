// Schematic, themed preview of one block, drawn on the editor canvas. It is NOT
// the real SSR renderer (that runs on the storefront + draft preview) — just a
// quick, recognisable sketch so the owner sees structure + theme while editing.
// All colours/fonts come from the CSS vars the canvas sets via
// storeThemeToCssVars, so it reflects the live theme automatically.
import type { CSSProperties } from 'react';
import type { StoreBlock } from '../../lib/store-blocks';
import { heroOverlayCss, coerceOverlayStyle, MAX_GALLERY_IMAGES } from '../../lib/store-blocks';
import { projectPhotoUrl } from '../../lib/storage';
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
}: {
  block: StoreBlock;
  storeName: string;
  assets: EditorAsset[];
}) {
  const p = block.props as Record<string, unknown>;

  switch (block.type) {
    case 'hero': {
      const bgAsset = assets.find((a) => a.id === str(p.bgImage));
      const bgUrl = bgAsset ? projectPhotoUrl(bgAsset.path) : null;
      const logoAsset = assets.find((a) => a.id === str(p.logo));
      const logoUrl = logoAsset ? projectPhotoUrl(logoAsset.path) : null;
      const overlay = heroOverlayCss(p.overlay, coerceOverlayStyle(p.overlayStyle));
      return (
        <div
          className="relative overflow-hidden rounded-xl px-4 py-6 text-center text-white"
          style={{ background: 'var(--store-header-bg)' }}
        >
          {bgUrl && (
            <img src={bgUrl} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" />
          )}
          {overlay !== 'transparent' && (
            <div className="absolute inset-0" style={{ background: overlay }} />
          )}
          <div className="relative">
            {logoUrl && (
              <img
                src={logoUrl}
                alt=""
                className="max-h-12 max-w-[70%] w-auto object-contain mx-auto mb-2 drop-shadow"
              />
            )}
            {(p.title === undefined ? storeName : String(p.title).trim()) && (
              <div {...HEAD_EDIT} style={headingStyle('1.125rem', true)}>
                {p.title === undefined ? storeName : String(p.title).trim()}
              </div>
            )}
            {str(p.tagline) && <div className="text-xs opacity-80 mt-1">{str(p.tagline)}</div>}
            {str(p.ctaText) && (
              <span
                className="inline-block mt-3 text-[11px] px-3 py-1 rounded-full"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}
              >
                {str(p.ctaText)}
              </span>
            )}
          </div>
        </div>
      );
    }

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
