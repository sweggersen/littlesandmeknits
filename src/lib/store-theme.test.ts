import { describe, it, expect } from 'vitest';
import {
  sanitizeStoreTheme,
  storeThemeToCssVars,
  isValidHex,
  isKnownFont,
  DEFAULT_STORE_THEME,
  STORE_COLOR_ROLES,
  STORE_FONTS,
} from './store-theme';

describe('isValidHex', () => {
  it('accepts #rgb and #rrggbb', () => {
    expect(isValidHex('#fff')).toBe(true);
    expect(isValidHex('#FAF6F0')).toBe(true);
    expect(isValidHex('#0a0A0a')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isValidHex('red')).toBe(false);
    expect(isValidHex('#ff')).toBe(false);
    expect(isValidHex('#gggggg')).toBe(false);
    expect(isValidHex('rgb(1,2,3)')).toBe(false);
    expect(isValidHex('#fff;')).toBe(false);
    expect(isValidHex(123)).toBe(false);
    expect(isValidHex(null)).toBe(false);
  });
});

describe('isKnownFont', () => {
  it('accepts curated ids only', () => {
    expect(isKnownFont('fraunces')).toBe(true);
    expect(isKnownFont('inter')).toBe(true);
    expect(isKnownFont('comic-sans')).toBe(false);
    expect(isKnownFont('')).toBe(false);
  });
});

describe('sanitizeStoreTheme', () => {
  it('fills a complete, valid theme from empty input', () => {
    const t = sanitizeStoreTheme({});
    expect(t).toEqual(DEFAULT_STORE_THEME);
    for (const role of STORE_COLOR_ROLES) expect(isValidHex(t.colors[role])).toBe(true);
  });

  it('keeps valid hex (normalised to uppercase) and known fonts', () => {
    const t = sanitizeStoreTheme({
      colors: { page: '#abcdef', primary: '#123' },
      fontDisplay: 'playfair',
      fontBody: 'dm-sans',
    });
    expect(t.colors.page).toBe('#ABCDEF');
    expect(t.colors.primary).toBe('#123');
    expect(t.fontDisplay).toBe('playfair');
    expect(t.fontBody).toBe('dm-sans');
  });

  it('replaces bad hex with the role default', () => {
    const t = sanitizeStoreTheme({ colors: { page: 'chartreuse', text: '#zzz' } });
    expect(t.colors.page).toBe(DEFAULT_STORE_THEME.colors.page);
    expect(t.colors.text).toBe(DEFAULT_STORE_THEME.colors.text);
  });

  it('falls back on unknown font ids', () => {
    const t = sanitizeStoreTheme({ fontDisplay: 'evil-font', fontBody: 42 });
    expect(t.fontDisplay).toBe(DEFAULT_STORE_THEME.fontDisplay);
    expect(t.fontBody).toBe(DEFAULT_STORE_THEME.fontBody);
  });

  it('drops unknown top-level and colour keys', () => {
    const t = sanitizeStoreTheme({
      colors: { page: '#fff', notARole: '#000', '__proto__': '#000' },
      script: '<script>',
    } as unknown);
    expect(Object.keys(t.colors).sort()).toEqual([...STORE_COLOR_ROLES].sort());
    expect((t as unknown as Record<string, unknown>).script).toBeUndefined();
  });

  it('neutralises CSS-injection payloads in colour values', () => {
    const payload = 'red;} body{display:none} .x{color:red';
    const t = sanitizeStoreTheme({ colors: { primary: payload, page: 'url(javascript:alert(1))' } });
    // Bad values are dropped, so defaults win.
    expect(t.colors.primary).toBe(DEFAULT_STORE_THEME.colors.primary);
    expect(t.colors.page).toBe(DEFAULT_STORE_THEME.colors.page);
  });
});

describe('storeThemeToCssVars', () => {
  it('emits only validated hex + known font families', () => {
    const css = storeThemeToCssVars({ colors: { page: '#abc' }, fontDisplay: 'playfair' });
    expect(css).toContain('--color-page:#ABC');
    expect(css).toContain('--font-display:"Playfair Display Variable"');
    // Every declaration is `--token:value` and value has no stray braces.
    expect(css).not.toContain('}');
    expect(css).not.toContain('<');
  });

  it('cannot be broken out of by a hostile theme value', () => {
    const css = storeThemeToCssVars({
      colors: { primary: '#000; } html{background:red}' },
      fontDisplay: '"; content: url(x)',
    });
    expect(css).not.toContain('html{');
    expect(css).not.toContain('content:');
    expect(css).not.toContain('}');
    // Font fell back to a hard-coded family.
    expect(css).toContain(STORE_FONTS[0].family);
  });

  it('always ends with a semicolon and defines every colour token', () => {
    const css = storeThemeToCssVars({});
    expect(css.endsWith(';')).toBe(true);
    expect(css).toContain('--color-primary:');
    expect(css).toContain('--color-surface:');
    expect(css).toContain('--store-header-bg:');
  });
});
