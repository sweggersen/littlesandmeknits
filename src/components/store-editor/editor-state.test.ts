import { describe, it, expect } from 'vitest';
import {
  addBlock,
  removeBlock,
  updateBlockProps,
  blocksToGrid,
  gridToBlocks,
  orderedBlocks,
  moveBlock,
  newBlockId,
} from './editor-state';
import { BLOCK_REGISTRY } from '../../lib/store-blocks';
import type { StoreBlock } from '../../lib/store-blocks';

function block(id: string, type: StoreBlock['type'], layout: Partial<StoreBlock['layout']> = {}): StoreBlock {
  return {
    id,
    type,
    layout: { x: 0, y: 0, w: 12, h: 3, ...layout },
    props: {},
  };
}

describe('editor-state', () => {
  it('newBlockId produces unique ids within the 1..64 char bound', () => {
    const a = newBlockId();
    const b = newBlockId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(64);
  });

  it('addBlock appends a block with the type defaults + a slot below the lowest', () => {
    const start = [block('a', 'hero', { y: 0, h: 3 })];
    const next = addBlock(start, 'textSection');
    expect(next).toHaveLength(2);
    const added = next[1];
    expect(added.type).toBe('textSection');
    // default props copied from the registry
    expect(added.props).toEqual(BLOCK_REGISTRY.textSection.defaultProps);
    // default span from the registry
    expect(added.layout.w).toBe(BLOCK_REGISTRY.textSection.defaultW);
    // placed below the previous block (y >= 0 + 3)
    expect(added.layout.y).toBe(3);
    // does not mutate the input
    expect(start).toHaveLength(1);
  });

  it('addBlock into an empty list starts at y=0', () => {
    const next = addBlock([], 'hero');
    expect(next[0].layout.y).toBe(0);
  });

  it('removeBlock drops only the matching id', () => {
    const start = [block('a', 'hero'), block('b', 'textSection')];
    expect(removeBlock(start, 'a').map((b) => b.id)).toEqual(['b']);
    expect(removeBlock(start, 'missing')).toHaveLength(2);
  });

  it('updateBlockProps shallow-merges into the target block only', () => {
    const start = [
      { ...block('a', 'textSection'), props: { heading: 'Old', body: 'keep' } },
      block('b', 'hero'),
    ];
    const next = updateBlockProps(start, 'a', { heading: 'New' });
    expect(next[0].props).toEqual({ heading: 'New', body: 'keep' });
    expect(next[1]).toBe(start[1]); // untouched reference
    // input not mutated
    expect(start[0].props.heading).toBe('Old');
  });

  it('blocksToGrid pins per-type minW/minH', () => {
    const grid = blocksToGrid([block('a', 'hero', { x: 1, y: 2, w: 8, h: 4 })]);
    expect(grid[0]).toMatchObject({
      i: 'a',
      x: 1,
      y: 2,
      w: 8,
      h: 4,
      minW: BLOCK_REGISTRY.hero.minW,
      minH: BLOCK_REGISTRY.hero.minH,
    });
  });

  it('gridToBlocks merges new positions, keeps blocks missing from the layout', () => {
    const start = [block('a', 'hero'), block('b', 'textSection', { y: 1 })];
    const next = gridToBlocks(start, [{ i: 'a', x: 3, y: 5, w: 6, h: 2 }]);
    expect(next[0].layout).toEqual({ x: 3, y: 5, w: 6, h: 2 });
    expect(next[1]).toBe(start[1]); // no layout entry -> unchanged
  });

  it('orderedBlocks sorts by y then x', () => {
    const start = [
      block('a', 'hero', { y: 2, x: 0 }),
      block('b', 'textSection', { y: 1, x: 4 }),
      block('c', 'contactInfo', { y: 1, x: 0 }),
    ];
    expect(orderedBlocks(start).map((b) => b.id)).toEqual(['c', 'b', 'a']);
  });

  it('moveBlock swaps row order for stacked blocks and is a no-op at the ends', () => {
    const start = [
      block('a', 'hero', { y: 0 }),
      block('b', 'textSection', { y: 1 }),
      block('c', 'contactInfo', { y: 2 }),
    ];
    const up = moveBlock(start, 'b', 'up');
    expect(up.find((x) => x.id === 'b')!.layout.y).toBe(0);
    expect(up.find((x) => x.id === 'a')!.layout.y).toBe(1);

    // top block can't move up
    expect(moveBlock(start, 'a', 'up')).toBe(start);
    // bottom block can't move down
    expect(moveBlock(start, 'c', 'down')).toBe(start);
  });

  it('moveBlock leaves same-row neighbours to drag (no-op)', () => {
    const start = [block('a', 'textSection', { y: 1, x: 0 }), block('b', 'contactInfo', { y: 1, x: 8 })];
    expect(moveBlock(start, 'a', 'down')).toBe(start);
  });
});
