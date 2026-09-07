import { describe, it, expect } from 'vitest';
import {
  sanitizePageConfig,
  sanitizeLayout,
  isKnownBlockType,
  hasBuilderConfig,
  BLOCK_REGISTRY,
  GRID_COLUMNS,
  STORE_BLOCK_TYPES,
} from './store-blocks';

describe('isKnownBlockType', () => {
  it('recognises registered types and rejects others', () => {
    expect(isKnownBlockType('hero')).toBe(true);
    expect(isKnownBlockType('productGrid')).toBe(true);
    expect(isKnownBlockType('evilBlock')).toBe(false);
    expect(isKnownBlockType('constructor')).toBe(false); // not an own key
    expect(isKnownBlockType(null)).toBe(false);
  });
});

describe('sanitizeLayout', () => {
  const def = BLOCK_REGISTRY.textSection;
  it('clamps width to [minW, 12] and keeps x+w on the grid', () => {
    expect(sanitizeLayout({ w: 999, x: 11, y: 3, h: 2 }, def).w).toBe(GRID_COLUMNS);
    const l = sanitizeLayout({ w: 6, x: 11, y: 0, h: 1 }, def);
    expect(l.x + l.w).toBeLessThanOrEqual(GRID_COLUMNS);
  });
  it('falls back to defaults for garbage', () => {
    const l = sanitizeLayout('nope', def);
    expect(l.w).toBe(def.defaultW);
    expect(l.y).toBe(0);
  });
});

describe('sanitizePageConfig', () => {
  it('drops unknown block types but keeps known ones', () => {
    const cfg = sanitizePageConfig({
      blocks: [
        { id: 'a', type: 'hero', layout: { x: 0, y: 0, w: 12, h: 3 }, props: {} },
        { id: 'b', type: 'evil', layout: {}, props: {} },
        { id: 'c', type: 'productGrid', layout: { x: 0, y: 1, w: 12, h: 5 }, props: {} },
      ],
    });
    expect(cfg.blocks.map((b) => b.type)).toEqual(['hero', 'productGrid']);
  });

  it('merges block defaults under provided props', () => {
    const cfg = sanitizePageConfig({
      blocks: [{ id: 'h', type: 'hero', layout: {}, props: { tagline: 'Hei' } }],
    });
    expect(cfg.blocks[0].props.tagline).toBe('Hei');
    // Default showBanner survives.
    expect(cfg.blocks[0].props.showBanner).toBe(true);
  });

  it('strips non-JSON prop values (functions) but keeps scalars/arrays', () => {
    const cfg = sanitizePageConfig({
      blocks: [
        {
          id: 'f',
          type: 'featuredProducts',
          layout: {},
          props: { ids: ['x', 'y', 3, {}], heading: 'H', evil: () => 1 },
        },
      ],
    });
    const props = cfg.blocks[0].props as Record<string, unknown>;
    expect(props.ids).toEqual(['x', 'y', 3]);
    expect(props.heading).toBe('H');
    expect(props.evil).toBeUndefined();
  });

  it('returns empty blocks for junk input', () => {
    expect(sanitizePageConfig(null).blocks).toEqual([]);
    expect(sanitizePageConfig({ blocks: 'no' }).blocks).toEqual([]);
    expect(sanitizePageConfig({ blocks: [1, 'x', null] }).blocks).toEqual([]);
  });

  it('assigns a stable id when missing', () => {
    const cfg = sanitizePageConfig({ blocks: [{ type: 'contactInfo', layout: {}, props: {} }] });
    expect(typeof cfg.blocks[0].id).toBe('string');
    expect(cfg.blocks[0].id.length).toBeGreaterThan(0);
  });
});

describe('hasBuilderConfig', () => {
  it('is true only for a non-empty, sanitisable config', () => {
    expect(hasBuilderConfig(null)).toBe(false);
    expect(hasBuilderConfig({ blocks: [] })).toBe(false);
    expect(hasBuilderConfig({ blocks: [{ type: 'unknown', layout: {}, props: {} }] })).toBe(false);
    expect(hasBuilderConfig({ blocks: [{ type: 'hero', layout: {}, props: {} }] })).toBe(true);
  });
});

describe('registry', () => {
  it('every registered type has complete metadata', () => {
    for (const type of STORE_BLOCK_TYPES) {
      const def = BLOCK_REGISTRY[type];
      expect(def.label).toBeTruthy();
      expect(def.minW).toBeGreaterThan(0);
      expect(def.defaultW).toBeGreaterThanOrEqual(def.minW);
      expect(def.defaultW).toBeLessThanOrEqual(GRID_COLUMNS);
    }
  });
});
