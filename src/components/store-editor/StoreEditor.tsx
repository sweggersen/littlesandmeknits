// "Butikk-lekeplass" — the interactive Phase 2 store page editor. A client:load
// island that composes the palette, canvas, theme + property panels and toolbar
// over a single source of truth (theme + blocks in React state). It debounce-
// saves to the DRAFT columns; Publiser copies draft -> live. Everything sent to
// the server is re-sanitised there, so this client is never trusted.
import { useEffect, useState } from 'react';
import type { Layout } from 'react-grid-layout';
import type { StoreBlock, StoreBlockType } from '../../lib/store-blocks';
import type { StoreTheme } from '../../lib/store-theme';
import { DEFAULT_STORE_THEME } from '../../lib/store-theme';
import { STORE_PRESETS } from '../../lib/store-presets';
import { STORE_EDITOR_LABELS as L } from '../../lib/labels';
import { addBlock, removeBlock, updateBlockProps, gridToBlocks, moveBlock } from './editor-state';
import { saveDraft, publishDraft, resetDraft } from './api';
import BlockPalette from './BlockPalette';
import ThemePanel from './ThemePanel';
import EditorCanvas from './EditorCanvas';
import PropertyPanel from './PropertyPanel';
import Toolbar, { type AsyncState } from './Toolbar';
import type { StoreEditorProps, EditorAsset } from './types';

function layoutsDiffer(blocks: StoreBlock[], next: StoreBlock[]): boolean {
  return next.some((b, i) => {
    const o = blocks[i];
    return !o || o.id !== b.id ||
      o.layout.x !== b.layout.x || o.layout.y !== b.layout.y ||
      o.layout.w !== b.layout.w || o.layout.h !== b.layout.h;
  });
}

export default function StoreEditor(props: StoreEditorProps) {
  const { slug, storeName, initialTheme, initialBlocks, initialAssets, listings } = props;

  const [theme, setTheme] = useState<StoreTheme>(initialTheme);
  const [blocks, setBlocks] = useState<StoreBlock[]>(initialBlocks);
  const [assets, setAssets] = useState<EditorAsset[]>(initialAssets);
  const [selectedId, setSelectedId] = useState<string | null>(initialBlocks[0]?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<AsyncState>('idle');
  const [publishState, setPublishState] = useState<AsyncState>('idle');
  const [error, setError] = useState<string | null>(null);

  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null;

  // useEffect runs only after client hydration — a deterministic "interactive"
  // signal for e2e (the island is SSR'd, so buttons exist before handlers bind).
  useEffect(() => setHydrated(true), []);

  function markDirty() {
    setDirty(true);
    setPublishState('idle');
  }

  // ── Mutations ──────────────────────────────────────────────────────
  function handleAddBlock(type: StoreBlockType) {
    const next = addBlock(blocks, type);
    setBlocks(next);
    setSelectedId(next[next.length - 1].id);
    markDirty();
  }
  function handleRemove(id: string) {
    setBlocks(removeBlock(blocks, id));
    if (selectedId === id) setSelectedId(null);
    markDirty();
  }
  function handleUpdateProps(patch: Record<string, unknown>) {
    if (!selectedBlock) return;
    setBlocks(updateBlockProps(blocks, selectedBlock.id, patch));
    markDirty();
  }
  function handleLayoutChange(layout: Layout[]) {
    const next = gridToBlocks(blocks, layout);
    if (!layoutsDiffer(blocks, next)) return;
    setBlocks(next);
    markDirty();
  }
  function handleThemeChange(t: StoreTheme) {
    setTheme(t);
    markDirty();
  }
  function handleApplyPreset(presetId: string) {
    const preset = STORE_PRESETS[presetId];
    if (!preset) return;
    // Deep clone so editing doesn't mutate the shared preset objects.
    setTheme(structuredClone(preset.theme));
    const clonedBlocks = structuredClone(preset.page_config.blocks) as StoreBlock[];
    setBlocks(clonedBlocks);
    setSelectedId(clonedBlocks[0]?.id ?? null);
    markDirty();
  }
  function handleAssetUploaded(asset: EditorAsset) {
    setAssets((prev) => [...prev, asset]);
  }

  // ── Persistence ────────────────────────────────────────────────────
  async function doSave(): Promise<boolean> {
    setSaveState('busy');
    setError(null);
    try {
      await saveDraft(slug, theme, blocks);
      setSaveState('done');
      setDirty(false);
      return true;
    } catch (e) {
      setSaveState('error');
      setError(e instanceof Error ? e.message : 'Lagring feilet');
      return false;
    }
  }

  // Debounced autosave: reschedules whenever theme/blocks change while dirty.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { void doSave(); }, 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, theme, blocks]);

  async function handlePreview() {
    if (dirty) await doSave();
    window.open(`/market/store/${encodeURIComponent(slug)}?preview=draft`, '_blank', 'noopener');
  }

  async function handlePublish() {
    if (dirty) {
      const okSave = await doSave();
      if (!okSave) return;
    }
    setPublishState('busy');
    setError(null);
    try {
      await publishDraft(slug);
      setPublishState('done');
    } catch (e) {
      setPublishState('error');
      setError(e instanceof Error ? e.message : 'Publisering feilet');
    }
  }

  async function handleReset() {
    if (!window.confirm(L.confirmReset)) return;
    setError(null);
    try {
      await resetDraft(slug);
      setTheme(structuredClone(DEFAULT_STORE_THEME));
      setBlocks([]);
      setSelectedId(null);
      setDirty(false);
      setSaveState('idle');
      setPublishState('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tilbakestilling feilet');
    }
  }

  return (
    <div className="space-y-4" data-store-editor data-hydrated={hydrated ? '1' : undefined}>
      <Toolbar
        dirty={dirty}
        saveState={saveState}
        publishState={publishState}
        error={error}
        onSave={() => void doSave()}
        onPreview={() => void handlePreview()}
        onPublish={() => void handlePublish()}
        onReset={() => void handleReset()}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_300px] gap-4 items-start">
        <aside className="space-y-6 lg:sticky lg:top-4">
          <BlockPalette onAdd={handleAddBlock} />
          <ThemePanel theme={theme} onChange={handleThemeChange} onApplyPreset={handleApplyPreset} />
        </aside>

        <main className="min-w-0">
          <EditorCanvas
            blocks={blocks}
            theme={theme}
            storeName={storeName}
            assets={assets}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onLayoutChange={handleLayoutChange}
            onRemove={handleRemove}
          />
        </main>

        <aside className="bg-surface rounded-2xl border border-sage-500/10 p-4 lg:sticky lg:top-4">
          <PropertyPanel
            block={selectedBlock}
            slug={slug}
            assets={assets}
            listings={listings}
            onUpdate={handleUpdateProps}
            onAssetUploaded={handleAssetUploaded}
            onMove={(dir) => { if (selectedBlock) { setBlocks(moveBlock(blocks, selectedBlock.id, dir)); markDirty(); } }}
          />
        </aside>
      </div>
    </div>
  );
}
