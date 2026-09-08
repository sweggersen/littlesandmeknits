import { describe, it, expect } from 'vitest';
import {
  sanitizeStoreTheme,
  storeThemeToCssVars,
  readableTextColor,
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

describe('readableTextColor', () => {
  it('picks black on light backgrounds and white on dark', () => {
    expect(readableTextColor('#FFFFFF')).toBe('#000000');
    expect(readableTextColor('#FAF6F0')).toBe('#000000');
    expect(readableTextColor('#8A9A5B')).toBe('#000000'); // mid sage default
    expect(readableTextColor('#000000')).toBe('#FFFFFF');
    expect(readableTextColor('#2C2A26')).toBe('#FFFFFF');
    expect(readableTextColor('#5B4B7A')).toBe('#FFFFFF'); // dark plum preset tag
  });
  it('handles #rgb shorthand', () => {
    expect(readableTextColor('#fff')).toBe('#000000');
    expect(readableTextColor('#000')).toBe('#FFFFFF');
  });
});

describe('tag colour + auto-contrast text', () => {
  it("emits --store-tag and an auto-contrasted --store-tag-fg", () => {
    const css = storeThemeToCssVars({ colors: { tag: '#111111' } });
    expect(css).toContain('--store-tag:#111111');
    expect(css).toContain('--store-tag-fg:#FFFFFF');
    const light = storeThemeToCssVars({ colors: { tag: '#EEEEEE' } });
    expect(light).toContain('--store-tag-fg:#000000');
  });
  it('sanitises a junk tag colour to the default', () => {
    const t = sanitizeStoreTheme({ colors: { tag: 'red;}body{}' } });
    expect(t.colors.tag).toBe(DEFAULT_STORE_THEME.colors.tag);
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

describe('sanitizeStoreTheme — body typography', () => {
  it('defaults the whole body block when absent', () => {
    const t = sanitizeStoreTheme({});
    expect(t.body).toEqual(DEFAULT_STORE_THEME.body);
    // The default body look is plain (normal weight, base size, no decoration).
    expect(t.body).toEqual({ weight: 'normal', italic: false, underline: false, scale: 'base' });
  });

  it('keeps valid body fields', () => {
    const t = sanitizeStoreTheme({
      body: { weight: 'medium', italic: true, underline: true, scale: 'lg' },
    });
    expect(t.body).toEqual({ weight: 'medium', italic: true, underline: true, scale: 'lg' });
  });

  it('coerces unknown weight / scale to the body default enum member', () => {
    const t = sanitizeStoreTheme({
      body: { weight: 'ultra-heavy; }', scale: 'gigantic', italic: false, underline: false },
    });
    expect(t.body.weight).toBe(DEFAULT_STORE_THEME.body.weight);
    expect(t.body.scale).toBe(DEFAULT_STORE_THEME.body.scale);
  });

  it('rejects non-boolean italic / underline (no truthy coercion)', () => {
    const t = sanitizeStoreTheme({
      body: { weight: 'bold', scale: 'sm', italic: 'true', underline: 1 },
    } as unknown);
    expect(t.body.italic).toBe(DEFAULT_STORE_THEME.body.italic);
    expect(t.body.underline).toBe(DEFAULT_STORE_THEME.body.underline);
    // Valid siblings still kept.
    expect(t.body.weight).toBe('bold');
    expect(t.body.scale).toBe('sm');
  });

  it('fills missing body fields with defaults (partial object)', () => {
    const t = sanitizeStoreTheme({ body: { underline: true } });
    expect(t.body.underline).toBe(true);
    expect(t.body.weight).toBe(DEFAULT_STORE_THEME.body.weight);
    expect(t.body.italic).toBe(DEFAULT_STORE_THEME.body.italic);
    expect(t.body.scale).toBe(DEFAULT_STORE_THEME.body.scale);
  });

  it('ignores a non-object body (string / null)', () => {
    expect(sanitizeStoreTheme({ body: 'red;}body{}' }).body).toEqual(DEFAULT_STORE_THEME.body);
    expect(sanitizeStoreTheme({ body: null }).body).toEqual(DEFAULT_STORE_THEME.body);
  });

  it('keeps heading and body independent', () => {
    const t = sanitizeStoreTheme({
      heading: { weight: 'bold', italic: false, underline: false, scale: 'xl' },
      body: { weight: 'medium', italic: true, underline: false, scale: 'sm' },
    });
    expect(t.heading).toEqual({ weight: 'bold', italic: false, underline: false, scale: 'xl' });
    expect(t.body).toEqual({ weight: 'medium', italic: true, underline: false, scale: 'sm' });
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

  it('emits the body typography vars from validated values', () => {
    const css = storeThemeToCssVars({
      body: { weight: 'bold', italic: true, underline: true, scale: 'xl' },
    });
    expect(css).toContain('--store-body-weight:700');
    expect(css).toContain('--store-body-style:italic');
    expect(css).toContain('--store-body-decoration:underline');
    expect(css).toContain('--store-body-scale:1.3');
  });

  it('emits the default body vars when the body block is absent', () => {
    const css = storeThemeToCssVars({});
    expect(css).toContain('--store-body-weight:400');
    expect(css).toContain('--store-body-style:normal');
    expect(css).toContain('--store-body-decoration:none');
    expect(css).toContain('--store-body-scale:1');
  });

  it('emits safe body vars even for a hostile body block', () => {
    const css = storeThemeToCssVars({
      body: { weight: '900;}x{', italic: 'yes', underline: 'no', scale: 'huge;}' },
    } as unknown);
    // weight/scale fell back to the default enum literals; flags to false.
    expect(css).toContain('--store-body-weight:400');
    expect(css).toContain('--store-body-style:normal');
    expect(css).toContain('--store-body-decoration:none');
    expect(css).toContain('--store-body-scale:1');
    expect(css).not.toContain('}');
    expect(css).not.toContain('x{');
  });
});
