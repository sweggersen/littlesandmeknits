// The middle canvas: blocks as selectable, draggable, resizable cards on a
// 12-col grid via react-grid-layout. Its CSS is imported from node_modules and
// bundled by Vite (no CDN — CSP-safe). The wrapper carries the theme CSS vars
// so every schematic preview reflects the live theme.
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import { BLOCK_REGISTRY, GRID_COLUMNS } from '../../lib/store-blocks';
import type { StoreBlock } from '../../lib/store-blocks';
import { storeThemeToCssVars, type StoreTheme } from '../../lib/store-theme';
import { blocksToGrid } from './editor-state';
import { STORE_EDITOR_LABELS as L } from '../../lib/labels';
import BlockPreview from './BlockPreview';
import type { EditorAsset } from './types';

const Grid = WidthProvider(GridLayout);
// A 1px row unit with ZERO vertical margin means a block's grid height equals
// its pixel height exactly — no row-snapping overshoot, so every block fits its
// content with no dead space. The uniform vertical gap between blocks is added
// as a transparent GAP spacer inside each cell (not via grid margin, which would
// re-introduce rounding). Horizontal margin still separates side-by-side blocks.
const ROW_HEIGHT = 1;
const MARGIN_X = 12;
const GAP = 12;

// Content-driven blocks auto-size to their content and aren't manually resized
// (no handles). Flexible blocks are user-sized via the bottom-right corner,
// which adjusts width and height together.
const FLEX_HANDLES: Layout['resizeHandles'] = ['se'];

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
  const typeById: Record<string, StoreBlock['type']> = {};
  for (const b of blocks) typeById[b.id] = b.type;

  // We measure every block's natural content height. Content-driven blocks
  // (contentHeight) render at exactly that height with no resize handles.
  // Flexible blocks use it as a floor (so text never clips) and can be grown
  // via the corner handle. `rowSpans` holds each block's measured row count.
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [rowSpans, setRowSpans] = useState<Record<string, number>>({});

  const measure = useCallback(() => {
    setRowSpans((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(cardRefs.current)) {
        const el = cardRefs.current[id];
        if (!el) continue;
        // 1px row unit: the natural content height (in px) IS the row count.
        const rows = Math.max(1, Math.ceil(el.scrollHeight));
        if (next[id] !== rows) { next[id] = rows; changed = true; }
      }
      return changed ? next : prev;
    });
  }, []);

  useLayoutEffect(() => { measure(); }, [blocks, theme, measure]);
  // Re-measure when a card's content resizes (image loads, text edits, etc.).
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    Object.values(cardRefs.current).forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [blocks, measure]);

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

  const layout = blocksToGrid(blocks).map((item) => {
    const content = BLOCK_REGISTRY[typeById[item.i]]?.contentHeight;
    // Cell height = natural content + the uniform bottom spacer.
    const floor = (rowSpans[item.i] ?? item.h) + GAP;
    return content
      ? { ...item, h: floor, resizeHandles: [], isResizable: false }
      // Never shorter than the content, so flexible blocks can't clip their
      // text; the user's corner-drag only adds space beyond that floor.
      : { ...item, h: Math.max(floor, item.h), resizeHandles: FLEX_HANDLES };
  });

  return (
    <div
      className="store-editor-canvas rounded-2xl p-3 sm:p-4 min-h-[50vh]"
      style={styleFromVars(cssVars)}
      data-editor-canvas
    >
      <Grid
        className="layout"
        layout={layout}
        cols={GRID_COLUMNS}
        rowHeight={ROW_HEIGHT}
        margin={[MARGIN_X, 0]}
        isBounded
        isResizable
        draggableHandle=".rgl-drag"
        onLayoutChange={onLayoutChange}
        compactType="vertical"
      >
        {blocks.map((block) => {
          const def = BLOCK_REGISTRY[block.type];
          const content = def.contentHeight;
          const selected = block.id === selectedId;
          const cardStyle = {
            background: 'var(--color-surface)',
            color: 'var(--color-charcoal)',
            border: selected ? '2px solid var(--color-primary)' : '1px solid var(--store-border)',
          };
          const card = (
            <>
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
              <div className="p-3">
                <BlockPreview block={block} storeName={storeName} assets={assets} />
              </div>
            </>
          );
          // Every cell = a bordered card + a transparent GAP spacer, so the gap
          // below every block is identical. We measure the inner (natural)
          // content for all blocks. Content blocks: the card hugs that content.
          // Flexible blocks: the card grows to fill the user-sized cell (never
          // shorter than the content, so text can't clip) while the inner stays
          // natural at the top — so measurement isn't skewed by the fill.
          return (
            <div
              key={block.id}
              className="flex flex-col"
              onMouseDownCapture={() => onSelect(block.id)}
              data-block-card={block.type}
            >
              <div
                className={content ? 'rounded-xl overflow-hidden flex flex-col' : 'rounded-xl overflow-hidden flex flex-col flex-1'}
                style={cardStyle}
              >
                <div ref={(el) => { cardRefs.current[block.id] = el; }} className="flex flex-col">
                  {card}
                </div>
              </div>
              <div style={{ height: GAP }} aria-hidden="true" />
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
