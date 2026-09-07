import { describe, it, expect } from 'vitest';
import { STORE_PRESETS, STORE_PRESET_IDS, getPreset } from './store-presets';
import { sanitizeStoreTheme, isKnownFont, isValidHex, STORE_COLOR_ROLES } from './store-theme';
import { sanitizePageConfig, isKnownBlockType } from './store-blocks';

describe('store presets', () => {
  it('exposes at least 3 presets', () => {
    expect(STORE_PRESET_IDS.length).toBeGreaterThanOrEqual(3);
  });

  it('getPreset resolves known ids and rejects unknown', () => {
    expect(getPreset('varm-klassisk')?.id).toBe('varm-klassisk');
    expect(getPreset('does-not-exist')).toBeNull();
    expect(getPreset('constructor')).toBeNull();
  });

  for (const id of STORE_PRESET_IDS) {
    const preset = STORE_PRESETS[id];

    it(`${id}: theme is already fully valid and survives sanitising unchanged`, () => {
      for (const role of STORE_COLOR_ROLES) expect(isValidHex(preset.theme.colors[role])).toBe(true);
      expect(isKnownFont(preset.theme.fontDisplay)).toBe(true);
      expect(isKnownFont(preset.theme.fontBody)).toBe(true);
      // Idempotent: sanitising a valid theme returns an equal theme.
      expect(sanitizeStoreTheme(preset.theme)).toEqual(preset.theme);
    });

    it(`${id}: page_config uses only known block types and survives sanitising`, () => {
      for (const b of preset.page_config.blocks) expect(isKnownBlockType(b.type)).toBe(true);
      const sanitised = sanitizePageConfig(preset.page_config);
      expect(sanitised.blocks.length).toBe(preset.page_config.blocks.length);
    });
  }
});
