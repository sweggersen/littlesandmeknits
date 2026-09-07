// The middle canvas: blocks as selectable, draggable, resizable cards on a
// 12-col grid via react-grid-layout. Its CSS is imported from node_modules and
// bundled by Vite (no CDN — CSP-safe). The wrapper carries the theme CSS vars
// so every schematic preview reflects the live theme.
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import { BLOCK_REGISTRY, GRID_COLUMNS } from '../../lib/store-blocks';
import type { StoreBlock } from '../../lib/store-blocks';
import { storeThemeToCssVars, type StoreTheme } from '../../lib/store-theme';
import { blocksToGrid } from './editor-state';
import { STORE_EDITOR_LABELS as L } from '../../lib/labels';
import BlockPreview from './BlockPreview';
import type { EditorAsset } from './types';

const Grid = WidthProvider(GridLayout);

export default function EditorCanvas({
  blocks,
  theme,
  storeName,
  assets,
  selectedId,
  onSelect,
  onLayoutChange,
  onRemove,
}: {
  blocks: StoreBlock[];
  theme: StoreTheme;
  storeName: string;
  assets: EditorAsset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLayoutChange: (layout: Layout[]) => void;
  onRemove: (id: string) => void;
}) {
  const cssVars = storeThemeToCssVars(theme);

  if (blocks.length === 0) {
    return (
      <div
        className="rounded-2xl p-10 text-center text-sm min-h-[50vh] flex items-center justify-center"
        style={{ ...(styleFromVars(cssVars)), border: '1px dashed var(--store-border)' }}
      >
        <span style={{ color: 'var(--store-muted)' }}>{L.emptyCanvas}</span>
      </div>
    );
  }

  return (
    <div
      className="store-editor-canvas rounded-2xl p-3 sm:p-4 min-h-[50vh]"
      style={styleFromVars(cssVars)}
      data-editor-canvas
    >
      <Grid
        className="layout"
        layout={blocksToGrid(blocks)}
        cols={GRID_COLUMNS}
        rowHeight={44}
        margin={[12, 12]}
        isBounded
        draggableHandle=".rgl-drag"
        onLayoutChange={onLayoutChange}
        compactType="vertical"
      >
        {blocks.map((block) => {
          const def = BLOCK_REGISTRY[block.type];
          const selected = block.id === selectedId;
          return (
            <div
              key={block.id}
              className="rounded-xl overflow-hidden flex flex-col"
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-charcoal)',
                border: selected ? '2px solid var(--color-primary)' : '1px solid var(--store-border)',
              }}
              onMouseDownCapture={() => onSelect(block.id)}
              data-block-card={block.type}
            >
              <div
                className="rgl-drag flex items-center justify-between px-2.5 py-1.5 cursor-move select-none text-[11px] font-medium"
                style={{ borderBottom: '1px solid var(--store-border)', color: 'var(--store-muted)' }}
              >
                <span>{def.label}</span>
                <button
                  type="button"
                  className="rgl-no-drag px-1.5 rounded hover:opacity-70"
                  aria-label={L.remove}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(block.id);
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="p-3 flex-1 min-h-0 overflow-hidden">
                <BlockPreview block={block} storeName={storeName} assets={assets} />
              </div>
            </div>
          );
        })}
      </Grid>
    </div>
  );
}

// storeThemeToCssVars returns a "--a:b;--c:d;" string; React's style prop wants
// an object. Parse the (already-safe, hard-coded-key) pairs into a style object.
function styleFromVars(cssVars: string): Record<string, string> {
  const out: Record<string, string> = {
    background: 'var(--color-page)',
    color: 'var(--color-charcoal)',
    fontFamily: 'var(--font-body)',
  };
  for (const decl of cssVars.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const key = decl.slice(0, idx).trim();
    const val = decl.slice(idx + 1).trim();
    if (key.startsWith('--')) out[key] = val;
  }
  return out;
}
