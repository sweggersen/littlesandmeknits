// Pure, side-effect-free helpers for the store editor's block state. Kept out
// of the React components so they're unit-testable without a DOM. Everything
// here only produces the SAME { id, type, layout, props } shape the Phase 1
// contract defines; the server re-sanitises on save, so this is convenience,
// not a trust boundary.

import { BLOCK_REGISTRY } from '../../lib/store-blocks';
import type { StoreBlock, StoreBlockType } from '../../lib/store-blocks';

let counter = 0;
/** Fresh client-side block id. The server accepts any 1..64-char id. */
export function newBlockId(): string {
  return `blk-${Date.now().toString(36)}-${(counter++).toString(36)}`;
}

/** Append a new block of `type` with its default props, in a layout slot below
 *  the current lowest block so it doesn't overlap. */
export function addBlock(blocks: StoreBlock[], type: StoreBlockType): StoreBlock[] {
  const def = BLOCK_REGISTRY[type];
  const maxY = blocks.reduce((m, b) => Math.max(m, b.layout.y + b.layout.h), 0);
  const block: StoreBlock = {
    id: newBlockId(),
    type,
    layout: { x: 0, y: maxY, w: def.defaultW, h: def.defaultH },
    props: { ...def.defaultProps },
  };
  return [...blocks, block];
}

export function removeBlock(blocks: StoreBlock[], id: string): StoreBlock[] {
  return blocks.filter((b) => b.id !== id);
}

/** Shallow-merge a props patch into one block. */
export function updateBlockProps(
  blocks: StoreBlock[],
  id: string,
  patch: Record<string, unknown>,
): StoreBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, props: { ...b.props, ...patch } } : b));
}

/** react-grid-layout item shape. */
export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  minH: number;
}

/** Map blocks -> react-grid-layout items, pinning per-type minimums. */
export function blocksToGrid(blocks: StoreBlock[]): GridItem[] {
  return blocks.map((b) => {
    const def = BLOCK_REGISTRY[b.type];
    return {
      i: b.id,
      x: b.layout.x,
      y: b.layout.y,
      w: b.layout.w,
      h: b.layout.h,
      minW: def.minW,
      minH: def.minH,
    };
  });
}

/** Merge react-grid-layout positions back into the block `layout`. Blocks not
 *  present in `layout` keep their existing position. */
export function gridToBlocks(
  blocks: StoreBlock[],
  layout: Array<{ i: string; x: number; y: number; w: number; h: number }>,
): StoreBlock[] {
  const byId = new Map(layout.map((l) => [l.i, l]));
  return blocks.map((b) => {
    const l = byId.get(b.id);
    if (!l) return b;
    // Keep the stored h: block height is auto-measured in the editor (content-
    // driven) and unused by the storefront, so it must not churn the draft.
    return { ...b, layout: { x: l.x, y: l.y, w: l.w, h: b.layout.h } };
  });
}

/** Order blocks the way the SSR renderer will lay them out (y then x). */
export function orderedBlocks(blocks: StoreBlock[]): StoreBlock[] {
  return [...blocks].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
}

/** Swap a block's row order with its neighbour (accessible reorder alongside
 *  drag). Swaps the two blocks' `y`; a no-op at the ends or when neighbours
 *  share a row (drag handles same-row cases). */
export function moveBlock(blocks: StoreBlock[], id: string, dir: 'up' | 'down'): StoreBlock[] {
  const ord = orderedBlocks(blocks);
  const idx = ord.findIndex((b) => b.id === id);
  if (idx < 0) return blocks;
  const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= ord.length) return blocks;
  const a = ord[idx];
  const b = ord[swapIdx];
  if (a.layout.y === b.layout.y) return blocks; // same row: leave to drag
  const ay = a.layout.y;
  const by = b.layout.y;
  return blocks.map((x) => {
    if (x.id === a.id) return { ...x, layout: { ...x.layout, y: by } };
    if (x.id === b.id) return { ...x, layout: { ...x.layout, y: ay } };
    return x;
  });
}
