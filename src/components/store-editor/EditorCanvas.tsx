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
// A fine row unit so the grid snaps tightly to content (small leftover gap) and
// vertical resizing of flexible blocks feels smooth.
const ROW_HEIGHT = 12;
const MARGIN = 10;

// Per-item resize affordances: content-driven blocks auto-size their height, so
// only horizontal resize is offered; flexible blocks are user-sized both ways.
const CONTENT_HANDLES: Layout['resizeHandles'] = ['e'];
const FLEX_HANDLES: Layout['resizeHandles'] = ['e', 's', 'se'];

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

  // Content-driven blocks (contentHeight) auto-size to their content, so the
  // editor measures each and offers only horizontal resize; the storefront
  // renders them at natural height too. Flexible blocks (text, contact, banner)
  // are user-sized in both directions, so they keep their stored grid `h`.
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [rowSpans, setRowSpans] = useState<Record<string, number>>({});

  const measure = useCallback(() => {
    setRowSpans((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(cardRefs.current)) {
        const el = cardRefs.current[id];
        if (!el) continue;
        const rows = Math.max(1, Math.ceil((el.scrollHeight + MARGIN) / (ROW_HEIGHT + MARGIN)));
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
    return content
      ? { ...item, h: rowSpans[item.i] ?? item.h, resizeHandles: CONTENT_HANDLES }
      : { ...item, resizeHandles: FLEX_HANDLES };
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
        margin={[MARGIN, MARGIN]}
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
              <div className={content ? 'p-3' : 'p-3 flex-1'}>
                <BlockPreview block={block} storeName={storeName} assets={assets} />
              </div>
            </>
          );
          // Content blocks: the bordered card is an inner wrapper at NATURAL
          // height (measured + observed for auto-fit), and the leftover grid
          // cell stays transparent so there's no dead space inside the card.
          // Flexible blocks: the bordered card fills the user-sized grid cell.
          return content ? (
            <div
              key={block.id}
              onMouseDownCapture={() => onSelect(block.id)}
              data-block-card={block.type}
            >
              <div
                ref={(el) => { cardRefs.current[block.id] = el; }}
                className="rounded-xl overflow-hidden flex flex-col"
                style={cardStyle}
              >
                {card}
              </div>
            </div>
          ) : (
            <div
              key={block.id}
              className="rounded-xl overflow-hidden flex flex-col h-full"
              style={cardStyle}
              onMouseDownCapture={() => onSelect(block.id)}
              data-block-card={block.type}
            >
              {card}
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
