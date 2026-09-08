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

/** Give hero blocks whose title was never set an explicit value equal to the
 *  store name, so the editor field shows a real, editable title. Leaves an
 *  empty-string title (an intentional "no title") untouched. */
function withHeroTitleDefaults(blocks: StoreBlock[], storeName: string): StoreBlock[] {
  return blocks.map((b) =>
    b.type === 'hero' && (b.props as Record<string, unknown>).title === undefined
      ? { ...b, props: { ...b.props, title: storeName } }
      : b,
  );
}

export default function StoreEditor(props: StoreEditorProps) {
  const { slug, storeName, initialTheme, initialBlocks, initialAssets, listings } = props;

  const [theme, setTheme] = useState<StoreTheme>(initialTheme);
  // Pre-fill hero titles with the store's own name so the "Butikknavn" field
  // holds a real, editable value. An undefined title (never set) becomes the
  // store name; an empty string is left alone so "cleared = no title" sticks.
  const [blocks, setBlocks] = useState<StoreBlock[]>(() => withHeroTitleDefaults(initialBlocks, storeName));
  const [assets, setAssets] = useState<EditorAsset[]>(initialAssets);
  const [selectedId, setSelectedId] = useState<string | null>(initialBlocks[0]?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<AsyncState>('idle');
  const [publishState, setPublishState] = useState<AsyncState>('idle');
  const [error, setError] = useState<string | null>(null);
  // Undo history: prior {theme, layout} snapshots, capped at 50.
  const [history, setHistory] = useState<{ theme: StoreTheme; blocks: StoreBlock[] }[]>([]);

  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null;

  // useEffect runs only after client hydration — a deterministic "interactive"
  // signal for e2e (the island is SSR'd, so buttons exist before handlers bind).
  useEffect(() => setHydrated(true), []);

  function markDirty() {
    setDirty(true);
    setPublishState('idle');
  }
  // Snapshot the current state BEFORE a mutation so Undo can restore it.
  function snapshot() {
    setHistory((h) => [...h.slice(-49), { theme: structuredClone(theme), blocks: structuredClone(blocks) }]);
  }
  function handleUndo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setTheme(prev.theme);
      setBlocks(prev.blocks);
      setSelectedId((cur) => (prev.blocks.some((b) => b.id === cur) ? cur : prev.blocks[0]?.id ?? null));
      setDirty(true);
      setPublishState('idle');
      return h.slice(0, -1);
    });
  }

  // ── Mutations ──────────────────────────────────────────────────────
  function handleAddBlock(type: StoreBlockType) {
    snapshot();
    const next = withHeroTitleDefaults(addBlock(blocks, type), storeName);
    setBlocks(next);
    setSelectedId(next[next.length - 1].id);
    markDirty();
  }
  function handleRemove(id: string) {
    snapshot();
    setBlocks(removeBlock(blocks, id));
    if (selectedId === id) setSelectedId(null);
    markDirty();
  }
  function handleUpdateProps(patch: Record<string, unknown>) {
    if (!selectedBlock) return;
    snapshot();
    setBlocks(updateBlockProps(blocks, selectedBlock.id, patch));
    markDirty();
  }
  // Patch a SPECIFIC block by id (the hero free-layout drag commits against the
  // dragged block, which may differ from the current selection). One snapshot
  // per call = one undo step per drag gesture.
  function handleUpdateBlockProps(id: string, patch: Record<string, unknown>) {
    snapshot();
    setBlocks(updateBlockProps(blocks, id, patch));
    markDirty();
  }
  function handleLayoutChange(layout: Layout[]) {
    const next = gridToBlocks(blocks, layout);
    if (!layoutsDiffer(blocks, next)) return;
    snapshot();
    setBlocks(next);
    markDirty();
  }
  function handleThemeChange(t: StoreTheme) {
    snapshot();
    setTheme(t);
    markDirty();
  }
  function handleApplyPreset(presetId: string) {
    const preset = STORE_PRESETS[presetId];
    if (!preset) return;
    snapshot();
    // A preset dictates COLOUR + FONT (the theme). It only seeds a starting
    // LAYOUT when the store has none yet, so picking a theme never wipes a
    // layout you've already built. Deep clone so editing doesn't mutate the
    // shared preset objects.
    setTheme(structuredClone(preset.theme));
    if (blocks.length === 0) {
      const clonedBlocks = structuredClone(preset.page_config.blocks) as StoreBlock[];
      setBlocks(clonedBlocks);
      setSelectedId(clonedBlocks[0]?.id ?? null);
    }
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
      snapshot();
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
      {/* Title + all actions in one sticky row, pinned below the site nav (h-16). */}
      <div className="sticky top-16 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 bg-linen border-b border-sage-500/10">
        <div className="flex items-center gap-4">
          <div className="shrink-0">
            <a href={`/market/store/${slug}/admin`} className="block text-xs text-charcoal/55 hover:text-charcoal leading-tight">← Administrasjon</a>
            <h1 className="font-serif text-lg sm:text-2xl leading-tight">{L.title}</h1>
          </div>
          <div className="flex-1 min-w-0">
            <Toolbar
              dirty={dirty}
              saveState={saveState}
              publishState={publishState}
              error={error}
              onSave={() => void doSave()}
              onPreview={() => void handlePreview()}
              onPublish={() => void handlePublish()}
              onReset={() => void handleReset()}
              onUndo={handleUndo}
              canUndo={history.length > 0}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_300px] gap-4 items-start">
        <aside className="space-y-6 lg:sticky lg:top-[132px]">
          <BlockPalette onAdd={handleAddBlock} existingTypes={blocks.map((b) => b.type)} />
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
            onUpdateProps={handleUpdateBlockProps}
            onRemove={handleRemove}
            onThemeChange={handleThemeChange}
            onApplyPreset={handleApplyPreset}
          />
        </main>

        <aside className="bg-surface rounded-2xl border border-sage-500/10 p-4 lg:sticky lg:top-[132px]">
          <PropertyPanel
            block={selectedBlock}
            slug={slug}
            storeName={storeName}
            assets={assets}
            listings={listings}
            onUpdate={handleUpdateProps}
            onAssetUploaded={handleAssetUploaded}
            onMove={(dir) => { if (selectedBlock) { snapshot(); setBlocks(moveBlock(blocks, selectedBlock.id, dir)); markDirty(); } }}
          />
        </aside>
      </div>
    </div>
  );
}
