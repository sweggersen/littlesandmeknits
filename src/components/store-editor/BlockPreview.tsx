// Schematic, themed preview of one block, drawn on the editor canvas. It is NOT
// the real SSR renderer (that runs on the storefront + draft preview) — just a
// quick, recognisable sketch so the owner sees structure + theme while editing.
// All colours/fonts come from the CSS vars the canvas sets via
// storeThemeToCssVars, so it reflects the live theme automatically.
import type { StoreBlock } from '../../lib/store-blocks';
import { projectPhotoUrl } from '../../lib/storage';
import type { EditorAsset } from './types';

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

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
    case 'hero':
      return (
        <div
          className="rounded-xl px-4 py-6 text-center text-white"
          style={{ background: 'var(--store-header-bg)' }}
        >
          <div className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
            {storeName}
          </div>
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
      );

    case 'textSection':
      return (
        <div>
          <div className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
            {str(p.heading, 'Tekstseksjon')}
          </div>
          <p className="text-xs opacity-70 mt-1 line-clamp-3">
            {str(p.body, 'Tekstinnhold vises her.')}
          </p>
        </div>
      );

    case 'productGrid':
      return (
        <div>
          <div className="text-sm font-semibold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            {str(p.heading, 'Annonser')}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square rounded"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--store-border)' }}
              />
            ))}
          </div>
          <div className="text-[10px] opacity-55 mt-1.5">Alle aktive annonser (maks {Number(p.limit) || 24})</div>
        </div>
      );

    case 'featuredProducts': {
      const ids = Array.isArray(p.ids) ? p.ids : [];
      return (
        <div>
          <div className="text-sm font-semibold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
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

    case 'contactInfo':
      return (
        <div>
          <div className="text-sm font-semibold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
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
