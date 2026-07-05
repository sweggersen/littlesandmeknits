import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Structural guard: keep every fee/payment calculation flowing through the
// money authority (money.ts). If a service starts computing a fee with raw
// arithmetic or by calling a fee formula directly, this fails CI — the money
// math must be assembled + validated in ONE place.
//
// This mirrors the env-boundary rule (cloudflare:workers only in env.ts).

const SERVICE_DIR = 'src/lib/services';
// Files allowed to reference fee formulas directly (the authority + the pure
// pricing modules it wraps, and their own tests).
const ALLOWED = new Set(['money.ts', 'money.test.ts', 'shipping.ts', 'commission-pricing.ts']);

function serviceFiles(): string[] {
  return readdirSync(SERVICE_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('._'))
    .map((f) => join(SERVICE_DIR, f));
}

describe('money boundary', () => {
  // Fee formula identifiers that must not be called outside the authority.
  const FORBIDDEN_CALLS = [/\btbFeeForPrice\s*\(/, /\bcommissionFeeNok\s*\(/];
  // Raw fee arithmetic: multiplying by a percentage or the fee constant inline.
  const FORBIDDEN_MATH = [
    /\*\s*COMMISSION_FEE_PERCENT/,      // e.g. price * COMMISSION_FEE_PERCENT / 100
    /\*\s*0\.[0-9]/,                     // e.g. * 0.08 or * 0.13  (a percentage fee)
    /application_fee_amount:\s*[^,\n]*[-+*/]/,  // inline arithmetic on the app fee
  ];

  it('services compute fees only via money.ts (no raw fee math)', () => {
    const offenders: string[] = [];
    for (const file of serviceFiles()) {
      const base = file.split('/').pop()!;
      if (ALLOWED.has(base)) continue;
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return; // skip comments
        for (const re of [...FORBIDDEN_CALLS, ...FORBIDDEN_MATH]) {
          if (re.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `Fee/payment math must go through MoneyBreakdown (src/lib/money.ts), not raw arithmetic:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
