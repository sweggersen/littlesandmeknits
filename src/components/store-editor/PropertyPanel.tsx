// Right-rail property panel: renders a form for the selected block, generated
// from BLOCK_REGISTRY[type].propSchema. One input per PropField kind.
import { useState } from 'react';
import { BLOCK_REGISTRY } from '../../lib/store-blocks';
import type { StoreBlock, PropField } from '../../lib/store-blocks';
import { projectPhotoUrl } from '../../lib/storage';
import { STORE_EDITOR_LABELS as L } from '../../lib/labels';
import { uploadAsset } from './api';
import type { EditorAsset, EditorListing } from './types';

export default function PropertyPanel({
  block,
  slug,
  assets,
  listings,
  onUpdate,
  onAssetUploaded,
}: {
  block: StoreBlock | null;
  slug: string;
  assets: EditorAsset[];
  listings: EditorListing[];
  onUpdate: (patch: Record<string, unknown>) => void;
  onAssetUploaded: (asset: EditorAsset) => void;
}) {
  if (!block) {
    return <p className="text-sm text-charcoal/50">{L.noSelection}</p>;
  }
  const def = BLOCK_REGISTRY[block.type];
  const props = block.props as Record<string, unknown>;

  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-charcoal/45">
        {L.properties} · {def.label}
      </h3>
      {def.propSchema.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={props[field.key]}
          slug={slug}
          assets={assets}
          listings={listings}
          onChange={(v) => onUpdate({ [field.key]: v })}
          onAssetUploaded={onAssetUploaded}
        />
      ))}
    </div>
  );
}

function Field({
  field,
  value,
  slug,
  assets,
  listings,
  onChange,
  onAssetUploaded,
}: {
  field: PropField;
  value: unknown;
  slug: string;
  assets: EditorAsset[];
  listings: EditorListing[];
  onChange: (v: unknown) => void;
  onAssetUploaded: (asset: EditorAsset) => void;
}) {
  const labelEl = (
    <span className="block text-xs font-medium text-charcoal/60 mb-1">{field.label}</span>
  );

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
            onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
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

    case 'url':
    case 'text':
    default:
      return (
        <label className="block">
          {labelEl}
          <input
            type={field.kind === 'url' ? 'url' : 'text'}
            value={typeof value === 'string' ? value : ''}
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
