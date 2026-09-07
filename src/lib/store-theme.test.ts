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

  it('splits heading colour from body/content colour', () => {
    const t = sanitizeStoreTheme({ colors: { heading: '#112233', text: '#445566' } });
    expect(t.colors.heading).toBe('#112233');
    expect(t.colors.text).toBe('#445566');
  });

  it('rejects a CSS-injection attempt in the heading colour to a safe default', () => {
    const t = sanitizeStoreTheme({ colors: { heading: 'red;}body{display:none' } });
    expect(t.colors.heading).toBe(DEFAULT_STORE_THEME.colors.heading);
    expect(isValidHex(t.colors.heading)).toBe(true);
  });
});

describe('sanitizeStoreTheme — heading typography', () => {
  it('defaults the whole heading block when absent', () => {
    const t = sanitizeStoreTheme({});
    expect(t.heading).toEqual(DEFAULT_STORE_THEME.heading);
  });

  it('keeps valid heading fields', () => {
    const t = sanitizeStoreTheme({
      heading: { weight: 'bold', italic: true, underline: true, scale: 'xl' },
    });
    expect(t.heading).toEqual({ weight: 'bold', italic: true, underline: true, scale: 'xl' });
  });

  it('coerces unknown weight / scale to the default enum member', () => {
    const t = sanitizeStoreTheme({
      heading: { weight: 'ultra-heavy; }', scale: 'gigantic', italic: false, underline: false },
    });
    expect(t.heading.weight).toBe(DEFAULT_STORE_THEME.heading.weight);
    expect(t.heading.scale).toBe(DEFAULT_STORE_THEME.heading.scale);
  });

  it('rejects non-boolean italic / underline (no truthy coercion)', () => {
    const t = sanitizeStoreTheme({
      heading: { weight: 'medium', scale: 'lg', italic: 'true', underline: 1 },
    } as unknown);
    expect(t.heading.italic).toBe(DEFAULT_STORE_THEME.heading.italic);
    expect(t.heading.underline).toBe(DEFAULT_STORE_THEME.heading.underline);
    // Valid siblings still kept.
    expect(t.heading.weight).toBe('medium');
    expect(t.heading.scale).toBe('lg');
  });

  it('fills missing heading fields with defaults (partial object)', () => {
    const t = sanitizeStoreTheme({ heading: { italic: true } });
    expect(t.heading.italic).toBe(true);
    expect(t.heading.weight).toBe(DEFAULT_STORE_THEME.heading.weight);
    expect(t.heading.underline).toBe(DEFAULT_STORE_THEME.heading.underline);
    expect(t.heading.scale).toBe(DEFAULT_STORE_THEME.heading.scale);
  });

  it('ignores a non-object heading (string / null)', () => {
    expect(sanitizeStoreTheme({ heading: 'red;}body{}' }).heading).toEqual(DEFAULT_STORE_THEME.heading);
    expect(sanitizeStoreTheme({ heading: null }).heading).toEqual(DEFAULT_STORE_THEME.heading);
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

  it('emits the heading typography vars from validated values', () => {
    const css = storeThemeToCssVars({
      colors: { heading: '#abc' },
      heading: { weight: 'bold', italic: true, underline: true, scale: 'lg' },
    });
    expect(css).toContain('--store-heading:#ABC');
    expect(css).toContain('--store-heading-weight:700');
    expect(css).toContain('--store-heading-style:italic');
    expect(css).toContain('--store-heading-decoration:underline');
    expect(css).toContain('--store-heading-scale:1.15');
  });

  it('emits safe heading vars even for a hostile heading block', () => {
    const css = storeThemeToCssVars({
      colors: { heading: 'red;}html{}' },
      heading: { weight: '900;}x{', italic: 'yes', underline: 'no', scale: 'huge;}' },
    } as unknown);
    // Colour fell back to a hex, weight/scale to the default enum literals.
    expect(css).toContain('--store-heading:#2C2A26');
    expect(css).toContain('--store-heading-weight:600');
    expect(css).toContain('--store-heading-style:normal');
    expect(css).toContain('--store-heading-decoration:none');
    expect(css).toContain('--store-heading-scale:1');
    expect(css).not.toContain('}');
    expect(css).not.toContain('html{');
  });
});
