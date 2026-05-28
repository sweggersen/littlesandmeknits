import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Static check that public/sw.js still ships the Strikkeklikker offline
// game. If someone simplifies the offline page back to a blank message,
// this fails to prompt a conscious decision.

describe('service worker offline page', () => {
  const sw = readFileSync(resolve('public/sw.js'), 'utf8');

  it('keeps the Norwegian offline copy', () => {
    expect(sw).toContain('Du er offline');
    expect(sw).toContain('Prøv igjen');
  });

  it('embeds the Strikkeklikker canvas game', () => {
    expect(sw).toContain('Strikkeklikker');
    expect(sw).toContain('<canvas');
    expect(sw).toContain("id=\"score\"");
    expect(sw).toContain('replay');
    expect(sw).toContain('pointerdown');
  });

  it('falls back to OFFLINE_HTML on navigation fetch failure', () => {
    // Sanity: the const and the fetch handler are both still wired up.
    expect(sw).toContain('const OFFLINE_HTML');
    expect(sw).toContain("req.mode === 'navigate'");
    expect(sw).toContain('OFFLINE_HTML');
  });
});
