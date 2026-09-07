import { describe, it, expect } from 'vitest';
import {
  sanitizePageConfig,
  sanitizeLayout,
  isKnownBlockType,
  hasBuilderConfig,
  coerceOverlayStyle,
  capAssetIds,
  heroOverlayCss,
  sanitizeHeroElements,
  HERO_OVERLAY_STYLES,
  HERO_ELEMENT_KEYS,
  HERO_LOGO_SCALE_MIN,
  HERO_LOGO_SCALE_MAX,
  MAX_GALLERY_IMAGES,
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

  it('keeps a hero title override and caps it at 80 chars', () => {
    const cfg = sanitizePageConfig({
      blocks: [
        { id: 'a', type: 'hero', layout: {}, props: { title: 'Fjellgarn' } },
        { id: 'b', type: 'hero', layout: {}, props: { title: 'x'.repeat(200) } },
      ],
    });
    expect(cfg.blocks[0].props.title).toBe('Fjellgarn');
    expect((cfg.blocks[1].props.title as string).length).toBe(80);
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

  it('registers the imageGallery block with an assetIds field', () => {
    expect(isKnownBlockType('imageGallery')).toBe(true);
    const field = BLOCK_REGISTRY.imageGallery.propSchema.find((f) => f.kind === 'assetIds');
    expect(field?.key).toBe('images');
    expect(BLOCK_REGISTRY.imageGallery.defaultProps.images).toEqual([]);
  });

  it('hero exposes logo + bgImage assetId fields and an overlay-style select', () => {
    const keys = BLOCK_REGISTRY.hero.propSchema.map((f) => `${f.key}:${f.kind}`);
    expect(keys).toContain('logo:assetId');
    expect(keys).toContain('bgImage:assetId');
    const sel = BLOCK_REGISTRY.hero.propSchema.find((f) => f.key === 'overlayStyle');
    expect(sel?.kind).toBe('select');
    // Every option value is a real overlay style.
    for (const o of sel?.options ?? []) {
      expect((HERO_OVERLAY_STYLES as readonly string[]).includes(o.value)).toBe(true);
    }
  });
});

describe('coerceOverlayStyle', () => {
  it('accepts the bounded set and defaults everything else to bottom', () => {
    for (const s of HERO_OVERLAY_STYLES) expect(coerceOverlayStyle(s)).toBe(s);
    expect(coerceOverlayStyle('diagonal')).toBe('bottom');
    expect(coerceOverlayStyle('rgba(0,0,0,1);}evil')).toBe('bottom');
    expect(coerceOverlayStyle(null)).toBe('bottom');
    expect(coerceOverlayStyle(42)).toBe('bottom');
  });
});

describe('capAssetIds', () => {
  it('keeps only non-empty strings, de-dupes, and caps at the max', () => {
    const many = Array.from({ length: 25 }, (_, i) => `a${i}`);
    expect(capAssetIds(many)).toHaveLength(MAX_GALLERY_IMAGES);
    expect(capAssetIds(['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(capAssetIds(['a', '', 3, null, 'b'] as unknown[])).toEqual(['a', 'b']);
    expect(capAssetIds('nope')).toEqual([]);
    expect(capAssetIds(['x', 'y'], 1)).toEqual(['x']);
  });
});

describe('heroOverlayCss', () => {
  it('clamps strength to 0-100 and never emits a user string', () => {
    // Only digits, dots, commas, parens and hard-coded keywords are ever present.
    const safe = /^(transparent|rgba\(0,0,0,[0-9.]+\)|(linear|radial)-gradient\([^;{}<>"']*\))$/;
    for (const style of HERO_OVERLAY_STYLES) {
      for (const strength of [-50, 0, 1, 45, 100, 9999]) {
        const css = heroOverlayCss(strength, style);
        expect(css).toMatch(safe);
        expect(css).not.toContain(';');
        expect(css).not.toContain('url(');
      }
    }
  });

  it('0 strength or "none" style yields transparent', () => {
    expect(heroOverlayCss(0, 'solid')).toBe('transparent');
    expect(heroOverlayCss(80, 'none')).toBe('transparent');
  });

  it('maps strength to alpha and picks the right gradient shape', () => {
    expect(heroOverlayCss(100, 'solid')).toBe('rgba(0,0,0,1.000)');
    expect(heroOverlayCss(50, 'bottom')).toBe('linear-gradient(180deg, rgba(0,0,0,0.175), rgba(0,0,0,0.500))');
    expect(heroOverlayCss(50, 'top')).toContain('linear-gradient(0deg');
    expect(heroOverlayCss(50, 'radial')).toContain('radial-gradient(ellipse at center');
  });
});

describe('sanitizePageConfig semantic clamping', () => {
  it('clamps hero overlay to 0-100 int and coerces overlayStyle to the enum', () => {
    const cfg = sanitizePageConfig({
      blocks: [
        { id: 'h', type: 'hero', layout: {}, props: { overlay: 250, overlayStyle: 'evil; }' } },
      ],
    });
    const props = cfg.blocks[0].props as Record<string, unknown>;
    expect(props.overlay).toBe(100);
    expect(props.overlayStyle).toBe('bottom');
  });

  it('applies default overlay when garbage is passed', () => {
    const cfg = sanitizePageConfig({
      blocks: [{ id: 'h', type: 'hero', layout: {}, props: { overlay: 'lots' } }],
    });
    expect((cfg.blocks[0].props as Record<string, unknown>).overlay).toBe(45);
  });

  it('caps gallery images at MAX_GALLERY_IMAGES and de-dupes', () => {
    const images = [...Array.from({ length: 15 }, (_, i) => `img${i}`), 'img0'];
    const cfg = sanitizePageConfig({
      blocks: [{ id: 'g', type: 'imageGallery', layout: {}, props: { images } }],
    });
    const kept = (cfg.blocks[0].props as Record<string, unknown>).images as string[];
    expect(kept).toHaveLength(MAX_GALLERY_IMAGES);
    expect(new Set(kept).size).toBe(kept.length); // no dupes
  });
});

describe('sanitizeHeroElements', () => {
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v);

  it('keeps valid positions for the four known keys as bounded integers', () => {
    const el = sanitizeHeroElements({
      logo: { x: 20, y: 30, scale: 55 },
      title: { x: 50, y: 45 },
      subtitle: { x: 50, y: 60 },
      cta: { x: 50, y: 80 },
    });
    expect(el).toBeDefined();
    expect(el).toEqual({
      logo: { x: 20, y: 30, scale: 55 },
      title: { x: 50, y: 45 },
      subtitle: { x: 50, y: 60 },
      cta: { x: 50, y: 80 },
    });
    for (const key of HERO_ELEMENT_KEYS) {
      expect(int(el![key]!.x)).toBe(true);
      expect(int(el![key]!.y)).toBe(true);
    }
  });

  it('clamps x/y to 0-100 and rounds to integers', () => {
    const el = sanitizeHeroElements({
      logo: { x: -50, y: 250, scale: 40 },
      title: { x: 33.7, y: 12.2 },
    });
    expect(el!.logo).toMatchObject({ x: 0, y: 100 });
    expect(el!.title).toEqual({ x: 34, y: 12 });
  });

  it('clamps the logo scale to the bounded percent range', () => {
    expect(sanitizeHeroElements({ logo: { x: 50, y: 50, scale: 500 } })!.logo!.scale).toBe(HERO_LOGO_SCALE_MAX);
    expect(sanitizeHeroElements({ logo: { x: 50, y: 50, scale: 1 } })!.logo!.scale).toBe(HERO_LOGO_SCALE_MIN);
    // Non-logo keys never carry a scale even if one is smuggled in.
    expect(sanitizeHeroElements({ title: { x: 50, y: 50, scale: 80 } })!.title).toEqual({ x: 50, y: 50 });
  });

  it('drops junk: extra keys, non-object entries, arrays, NaN and non-numeric coords', () => {
    const el = sanitizeHeroElements({
      logo: { x: 40, y: 40 },
      title: 'nope',
      subtitle: [1, 2],
      cta: { x: NaN, y: 10 },
      evil: { x: 10, y: 10 },
      constructor: { x: 10, y: 10 },
    });
    // Only the one valid element survives; unknown keys are never present.
    expect(el).toEqual({ logo: { x: 40, y: 40 } });
    expect(Object.keys(el!)).toEqual(['logo']);
  });

  it('drops an element whose x or y is a string (never coerced)', () => {
    expect(sanitizeHeroElements({ title: { x: '50', y: 20 } })).toBeUndefined();
    expect(sanitizeHeroElements({ title: { x: 50 } })).toBeUndefined(); // missing y
  });

  it('returns undefined for non-object / empty / all-invalid input', () => {
    expect(sanitizeHeroElements(undefined)).toBeUndefined();
    expect(sanitizeHeroElements(null)).toBeUndefined();
    expect(sanitizeHeroElements('x')).toBeUndefined();
    expect(sanitizeHeroElements([{ x: 1, y: 1 }])).toBeUndefined();
    expect(sanitizeHeroElements({})).toBeUndefined();
    expect(sanitizeHeroElements({ title: {} })).toBeUndefined();
  });

  it('is applied by sanitizePageConfig on the hero block', () => {
    const cfg = sanitizePageConfig({
      blocks: [
        {
          id: 'h',
          type: 'hero',
          layout: {},
          props: {
            elements: {
              logo: { x: 999, y: -10, scale: 9999 },
              title: { x: 50.4, y: 40.6 },
              bogus: { x: 1, y: 1 },
            },
          },
        },
      ],
    });
    const props = cfg.blocks[0].props as Record<string, unknown>;
    expect(props.elements).toEqual({
      logo: { x: 100, y: 0, scale: HERO_LOGO_SCALE_MAX },
      title: { x: 50, y: 41 },
    });
  });

  it('omits elements entirely when absent or all-invalid, so defaults apply', () => {
    const noEl = sanitizePageConfig({
      blocks: [{ id: 'h', type: 'hero', layout: {}, props: {} }],
    });
    expect('elements' in (noEl.blocks[0].props as Record<string, unknown>)).toBe(false);

    const badEl = sanitizePageConfig({
      blocks: [{ id: 'h', type: 'hero', layout: {}, props: { elements: { title: 'x' } } }],
    });
    expect('elements' in (badEl.blocks[0].props as Record<string, unknown>)).toBe(false);
  });
});
