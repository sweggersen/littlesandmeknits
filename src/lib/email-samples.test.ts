import { describe, it, expect } from 'vitest';
import { EMAIL_SAMPLES, EMAIL_SAMPLE_KEYS } from './email-samples';

describe('email-samples', () => {
  it('exposes a non-empty set of templates', () => {
    expect(EMAIL_SAMPLE_KEYS.length).toBeGreaterThan(0);
  });

  it('every sample renders to non-empty subject + html with no unresolved placeholders', () => {
    const siteUrl = 'http://localhost:4321';
    for (const [key, fn] of Object.entries(EMAIL_SAMPLES)) {
      const result = fn(siteUrl, 'Sam');
      expect(result.subject, `${key}.subject empty`).toBeTruthy();
      expect(result.html, `${key}.html missing tag`).toContain('<html');
      expect(result.html, `${key} leaves {{siteUrl}} unresolved`).not.toContain('{{siteUrl}}');
    }
  });

  it('CTA URLs in the HTML are absolute (siteUrl prefixed)', () => {
    const siteUrl = 'http://localhost:4321';
    for (const [key, fn] of Object.entries(EMAIL_SAMPLES)) {
      const { html } = fn(siteUrl, null);
      // Every template should reference the siteUrl at least once for CTAs / footer links.
      expect(html, `${key} never references siteUrl`).toContain(siteUrl);
    }
  });
});
