// Right-rail property panel: renders a form for the selected block, generated
// from BLOCK_REGISTRY[type].propSchema. One input per PropField kind.
import { useState } from 'react';
import { BLOCK_REGISTRY, MAX_GALLERY_IMAGES } from '../../lib/store-blocks';
import type { StoreBlock, PropField } from '../../lib/store-blocks';
import { projectPhotoUrl } from '../../lib/storage';
import { STORE_EDITOR_LABELS as L } from '../../lib/labels';
import { uploadAsset } from './api';
import type { EditorAsset, EditorListing } from './types';

export default function PropertyPanel({
  block,
  slug,
  storeName,
  assets,
  listings,
  onUpdate,
  onAssetUploaded,
  onMove,
}: {
  block: StoreBlock | null;
  slug: string;
  storeName: string;
  assets: EditorAsset[];
  listings: EditorListing[];
  onUpdate: (patch: Record<string, unknown>) => void;
  onAssetUploaded: (asset: EditorAsset) => void;
  onMove?: (dir: 'up' | 'down') => void;
}) {
  if (!block) {
    return <p className="text-sm text-charcoal/50">{L.noSelection}</p>;
  }
  const def = BLOCK_REGISTRY[block.type];
  const props = block.props as Record<string, unknown>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-charcoal/45">
          {L.properties} · {def.label}
        </h3>
        {onMove && (
          <div className="flex gap-1 shrink-0">
            <button type="button" onClick={() => onMove('up')} title={L.moveUp}
              className="text-xs w-7 h-7 rounded-full border border-sage-500/30 hover:bg-oatmeal/40">↑</button>
            <button type="button" onClick={() => onMove('down')} title={L.moveDown}
              className="text-xs w-7 h-7 rounded-full border border-sage-500/30 hover:bg-oatmeal/40">↓</button>
          </div>
        )}
      </div>
      {def.propSchema.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={props[field.key]}
          slug={slug}
          storeName={storeName}
          assets={assets}
          listings={listings}
          onChange={(v) => onUpdate({ [field.key]: v })}
          onAssetUploaded={onAssetUploaded}
        />
      ))}
      {block.type === 'hero' && (
        <div className="pt-2 mt-1 border-t border-sage-500/15 space-y-1.5">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-charcoal/45">
            {L.heroLayout}
          </span>
          <p className="text-[11px] text-charcoal/45">{L.heroLayoutHint}</p>
          {props.elements != null && (
            <button
              type="button"
              onClick={() => onUpdate({ elements: undefined })}
              className="text-xs px-3 py-1.5 rounded-full border border-sage-500/30 hover:bg-oatmeal/40"
              data-hero-reset-layout
            >
              {L.heroResetLayout}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  field,
  value,
  slug,
  storeName,
  assets,
  listings,
  onChange,
  onAssetUploaded,
}: {
  field: PropField;
  value: unknown;
  slug: string;
  storeName: string;
  assets: EditorAsset[];
  listings: EditorListing[];
  onChange: (v: unknown) => void;
  onAssetUploaded: (asset: EditorAsset) => void;
}) {
  const labelEl = (
    <span className="block text-xs font-medium text-charcoal/60 mb-1">{field.label}</span>
  );
  // `{store}` in a placeholder resolves to the store's own name.
  const placeholder = field.placeholder?.replace('{store}', storeName);

  switch (field.kind) {
    case 'boolean':
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            data-prop={field.key}
          />
          <span className="text-sm text-charcoal/75">{field.label}</span>
        </label>
      );

    case 'number':
      return (
        <label className="block">
          {labelEl}
          <input
            type="number"
            value={typeof value === 'number' ? value : ''}
            /* Empty clears the value (falls back to the block default) instead of
               forcing a 0 you can't delete. */
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            className="w-full bg-surface rounded-lg border border-sage-500/20 px-2.5 py-1.5 text-sm"
            data-prop={field.key}
          />
        </label>
      );

    case 'textarea':
      return (
        <label className="block">
          {labelEl}
          <textarea
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            className="w-full bg-surface rounded-lg border border-sage-500/20 px-2.5 py-1.5 text-sm resize-y"
            data-prop={field.key}
          />
        </label>
      );

    case 'assetId':
      return (
        <div>
          {labelEl}
          <AssetPicker
            value={typeof value === 'string' ? value : ''}
            slug={slug}
            assets={assets}
            onChange={onChange}
            onAssetUploaded={onAssetUploaded}
          />
        </div>
      );

    case 'assetIds':
      return (
        <div>
          {labelEl}
          <MultiAssetPicker
            value={Array.isArray(value) ? (value as string[]) : []}
            slug={slug}
            assets={assets}
            max={MAX_GALLERY_IMAGES}
            onChange={onChange}
            onAssetUploaded={onAssetUploaded}
          />
        </div>
      );

    case 'listingIds':
      return (
        <div>
          {labelEl}
          <ListingPicker
            value={Array.isArray(value) ? (value as string[]) : []}
            listings={listings}
            onChange={onChange}
          />
        </div>
      );

    case 'select':
      return (
        <label className="block">
          {labelEl}
          <select
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-surface rounded-lg border border-sage-500/20 px-2.5 py-1.5 text-sm"
            data-prop={field.key}
          >
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      );

    case 'color':
      return (
        <label className="block">
          {labelEl}
          <input
            type="color"
            value={typeof value === 'string' && value ? value : '#000000'}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="w-full h-9 bg-surface rounded-lg border border-sage-500/20 px-1 py-0.5 cursor-pointer"
            data-prop={field.key}
          />
        </label>
      );

    case 'url':
    case 'text':
    default:
      return (
        <label className="block">
          {labelEl}
          <input
            type={field.kind === 'url' ? 'url' : 'text'}
            value={typeof value === 'string' ? value : ''}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-surface rounded-lg border border-sage-500/20 px-2.5 py-1.5 text-sm"
            data-prop={field.key}
          />
        </label>
      );
  }
}

function AssetPicker({
  value,
  slug,
  assets,
  onChange,
  onAssetUploaded,
}: {
  value: string;
  slug: string;
  assets: EditorAsset[];
  onChange: (v: string) => void;
  onAssetUploaded: (asset: EditorAsset) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { asset } = await uploadAsset(slug, 'gallery', file);
      onAssetUploaded(asset);
      onChange(asset.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opplasting feilet');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {assets.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {assets.map((a) => {
            const url = projectPhotoUrl(a.path);
            const selected = a.id === value;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onChange(selected ? '' : a.id)}
                className="aspect-square rounded-lg overflow-hidden"
                style={{ outline: selected ? '2px solid var(--color-primary, #C76D4E)' : 'none' }}
                data-asset={a.id}
                aria-pressed={selected}
              >
                {url ? (
                  <img src={url} alt={a.alt ?? ''} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[10px]">?</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <label className="inline-flex items-center gap-2 text-xs font-medium text-primary cursor-pointer">
        <span className="px-3 py-1.5 rounded-full border border-primary/40 hover:bg-oatmeal/40 transition-colors">
          {busy ? L.uploading : L.upload}
        </span>
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={busy} data-upload />
      </label>
      {!value && assets.length === 0 && <p className="text-[11px] text-charcoal/45 mt-1">{L.noImage}</p>}
      {error && <p className="text-[11px] text-terracotta-700 mt-1">{error}</p>}
    </div>
  );
}

function MultiAssetPicker({
  value,
  slug,
  assets,
  max,
  onChange,
  onAssetUploaded,
}: {
  value: string[];
  slug: string;
  assets: EditorAsset[];
  max: number;
  onChange: (v: string[]) => void;
  onAssetUploaded: (asset: EditorAsset) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atMax = value.length >= max;

  function toggle(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((x) => x !== id));
    } else if (!atMax) {
      onChange([...value, id]);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { asset } = await uploadAsset(slug, 'gallery', file);
      onAssetUploaded(asset);
      // Auto-select the freshly uploaded image if there's room.
      if (value.length < max) onChange([...value, asset.id]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opplasting feilet');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {assets.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {assets.map((a) => {
            const url = projectPhotoUrl(a.path);
            const order = value.indexOf(a.id);
            const selected = order >= 0;
            const disabled = !selected && atMax;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                disabled={disabled}
                className="relative aspect-square rounded-lg overflow-hidden disabled:opacity-40"
                style={{ outline: selected ? '2px solid var(--color-primary, #C76D4E)' : 'none' }}
                data-asset={a.id}
                aria-pressed={selected}
              >
                {url ? (
                  <img src={url} alt={a.alt ?? ''} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[10px]">?</span>
                )}
                {selected && (
                  <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-primary text-primary-fg text-[11px] font-bold flex items-center justify-center">
                    {order + 1}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <label className="inline-flex items-center gap-2 text-xs font-medium text-primary cursor-pointer">
        <span className="px-3 py-1.5 rounded-full border border-primary/40 hover:bg-oatmeal/40 transition-colors">
          {busy ? L.uploading : L.upload}
        </span>
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={busy || atMax} data-upload />
      </label>
      <p className="text-[11px] text-charcoal/45 mt-1">
        {atMax ? L.maxImagesReached : `${value.length} / ${max}`}
      </p>
      {error && <p className="text-[11px] text-terracotta-700 mt-1">{error}</p>}
    </div>
  );
}

function ListingPicker({
  value,
  listings,
  onChange,
}: {
  value: string[];
  listings: EditorListing[];
  onChange: (v: string[]) => void;
}) {
  if (listings.length === 0) {
    return <p className="text-[11px] text-charcoal/45">{L.noListings}</p>;
  }
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
      {listings.map((l) => (
        <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={value.includes(l.id)}
            onChange={() => toggle(l.id)}
            data-listing={l.id}
          />
          <span className="truncate flex-1">{l.title}</span>
          <span className="text-[11px] text-charcoal/45">{l.price_nok} kr</span>
        </label>
      ))}
    </div>
  );
}
