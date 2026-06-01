import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Static analysis of webhook.ts. The webhook is hard to unit-test
// because it imports Cloudflare env, validates Stripe signatures,
// and exports a POST handler tied to Astro's APIRoute type.
//
// What we CAN assert at unit-test time: every code path that returns
// a 500 ("DB error") must call recordDeadLetter just before it. R2-2
// found 5 such paths previously calling console.error and going
// silent. This test pins that they all use the dead-letter helper
// so the support team has an audit row when a webhook retry exhausts.

const webhookSrc = readFileSync(
  fileURLToPath(new URL('./webhook.ts', import.meta.url)),
  'utf8',
);

describe('stripe webhook → dead-letter wiring', () => {
  it('imports recordDeadLetter', () => {
    expect(webhookSrc).toMatch(/import \{[^}]*recordDeadLetter[^}]*\} from .*['"]\.\.\/\.\.\/\.\.\/lib\/services\/dead-letter['"]/);
  });

  it('every "DB error" 500 response is preceded by a recordDeadLetter call', () => {
    const dbErrorReturns = [...webhookSrc.matchAll(/return new Response\(['"]DB error['"]/g)];
    expect(dbErrorReturns.length).toBeGreaterThan(0);

    for (const match of dbErrorReturns) {
      // Look at the 600 chars before this `return` — recordDeadLetter
      // should be in that window (current branches are all small).
      const window = webhookSrc.slice(Math.max(0, match.index! - 600), match.index!);
      expect(
        window,
        `500 "DB error" at offset ${match.index} is not preceded by recordDeadLetter — silent failure!`,
      ).toMatch(/recordDeadLetter\(/);
    }
  });

  it('every recordDeadLetter call passes a service label and a context object', () => {
    // Match the call site + a generous window after to clear the
    // closing `)` even when the second arg is a multi-line object.
    const calls = [...webhookSrc.matchAll(/recordDeadLetter\(/g)];
    expect(calls.length).toBeGreaterThan(0);

    for (const m of calls) {
      const window = webhookSrc.slice(m.index!, m.index! + 600);
      expect(window, `recordDeadLetter call missing service label near offset ${m.index}`)
        .toMatch(/service:\s*['"]/);
      expect(window, `recordDeadLetter call missing context object near offset ${m.index}`)
        .toMatch(/context:\s*\{/);
    }
  });

  it('uses the dlCtx helper rather than passing { admin, user } inline', () => {
    // The helper centralises the (supabase, userId | null) → ctx shape
    // so future paths get the same null-handling.
    expect(webhookSrc).toMatch(/function dlCtx\(/);
    const inlineCtxCalls = webhookSrc.match(/recordDeadLetter\(\s*\{\s*admin:/g);
    expect(inlineCtxCalls, 'inline { admin, user } ctx slipped past the helper').toBeNull();
  });
});
