import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// CLAUDE.md: no em-dash (—) in user-facing Norwegian copy. A prior sweep cleaned
// src/pages/** and src/components/**, but notification titles/bodies and fail()
// error messages are authored in the SERVICE + API layer, which no guard
// covered — so em-dashes regressed there (review 4). This guard scans those
// files for em-dashes on lines carrying a user-facing-copy marker
// (title:/body:/fail(/message:), which are always display strings — never
// comments — so it stays false-positive-free while pinning the copy that
// actually reaches /inbox and error toasts.

const ROOTS = ['src/lib/services', 'src/pages/api'];
const COPY_MARKER = /(?:\btitle:|\bbody:|\bmessage:|\bfail\()/;
const EM_DASH = '—';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('no em-dash in service/api user-facing copy', () => {
  it('has no em-dash on any title:/body:/message:/fail() line', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          const trimmed = line.trimStart();
          // Skip comment lines (they may legitimately use em-dashes).
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
          if (line.includes(EM_DASH) && COPY_MARKER.test(line)) {
            offenders.push(`${file}:${i + 1}: ${trimmed.slice(0, 100)}`);
          }
        });
      }
    }
    expect(offenders, `Em-dash in user-facing copy (use comma/period/·):\n${offenders.join('\n')}`).toEqual([]);
  });
});
