import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Static-analysis test: pin the soft-delete invariant.
//
// Any query against `stores` table (other than an explicitly-marked exception)
// must include either:
//   - `.is('deleted_at', null)` — filter deleted rows
//   - `notDeleted(...)` — equivalent helper from src/lib/db/soft-delete.ts
//   - `SOFT_DELETE_EXCEPTION_NOTE` reference in a nearby comment — explicit
//     opt-out for admin / archived-preview readers.
//
// This catches "I added a new store reader and forgot the filter" at PR-review
// time, before the bug ships.

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.astro' || name === 'dist') continue;
      walk(path, out);
    } else if (/\.(ts|astro)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  snippet: string;
}

function findStoreQueries(file: string): Hit[] {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const hits: Hit[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match either .from('stores') or .from("stores") (not store_members, etc.)
    if (!/\.from\((['"])stores\1\)/.test(line)) continue;

    // Look at a window around the .from() call: 4 lines before (for
    // exception-note comments) and 11 after (for chained filters).
    const windowText = lines.slice(Math.max(0, i - 8), i + 12).join('\n');

    // Skip non-listing operations and id-lookups — they're not "list all stores"
    // queries, so missing the deleted_at filter isn't a footgun.
    const isWriter =
      /\.update\(/.test(windowText) ||
      /\.insert\(/.test(windowText) ||
      /\.delete\(\)/.test(windowText) ||
      /\.upsert\(/.test(windowText);
    if (isWriter) continue;

    // ID-lookups (`.eq('id', ...)` or `.in('id', ...)`) are specific-row reads
    // — applying deleted_at would just turn them into "null instead of the row".
    // Fine either way; not a bug.
    const isIdLookup =
      /\.eq\(\s*['"]id['"]\s*,/.test(windowText) ||
      /\.in\(\s*['"]id['"]\s*,/.test(windowText);
    if (isIdLookup) continue;

    const hasFilter =
      /\.is\(\s*['"]deleted_at['"]\s*,\s*null\s*\)/.test(windowText) ||
      /notDeleted\(/.test(windowText) ||
      /SOFT_DELETE_EXCEPTION_NOTE/.test(windowText);

    if (!hasFilter) {
      hits.push({ file, line: i + 1, snippet: line.trim() });
    }
  }
  return hits;
}

describe('soft-delete invariant', () => {
  it('every stores reader either filters deleted_at or is an explicit exception', () => {
    const root = new URL('../../', import.meta.url).pathname;
    const allFiles = walk(root);
    const missing: Hit[] = [];
    for (const f of allFiles) {
      // Skip this test, types, the helper itself.
      if (f.endsWith('soft-delete.test.ts')) continue;
      if (f.endsWith('soft-delete.ts')) continue;
      if (f.endsWith('database.types.ts')) continue;
      missing.push(...findStoreQueries(f));
    }

    if (missing.length > 0) {
      const msg = missing
        .map((h) => `  ${h.file.replace(root, '')}:${h.line}  ${h.snippet}`)
        .join('\n');
      throw new Error(
        `Found ${missing.length} stores query without deleted_at filter:\n${msg}\n\n` +
          `Add .is('deleted_at', null) — or wrap with notDeleted() from src/lib/db/soft-delete.ts.\n` +
          `If the reader *intentionally* includes deleted rows, reference SOFT_DELETE_EXCEPTION_NOTE\n` +
          `in a comment within 12 lines of the .from('stores') call.`,
      );
    }
    expect(missing).toHaveLength(0);
  });
});
