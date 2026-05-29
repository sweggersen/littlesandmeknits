// Norwegian bank account number (kontonummer) validator.
//
// Format: 11 digits, the last is a MOD-11 check digit over the first 10
// with weights 5,4,3,2,7,6,5,4,3,2 (little-endian over the leading
// digits, ending in weight 2 for digit 10).
//
// We accept input with spaces, dots, or hyphens between groups
// (e.g. "1234 56 78901", "1234.56.78901", "12345678901") and
// normalize to bare digits.

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

export function normalizeKontonummer(input: string): string {
  return input.replace(/[\s.\-]/g, '');
}

export function isValidKontonummer(input: string | null | undefined): boolean {
  if (!input) return false;
  const digits = normalizeKontonummer(input);
  if (!/^\d{11}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i], 10) * WEIGHTS[i];
  const remainder = sum % 11;
  // MOD-11: a remainder of 0 means check digit is 0; remainder of 1 is
  // invalid (would require check digit 10, which doesn't fit one slot).
  const expected = remainder === 0 ? 0 : 11 - remainder;
  if (expected === 10) return false;
  return parseInt(digits[10], 10) === expected;
}

// Display form: "1234 56 78901" (4-2-5 grouping, the Norwegian convention).
export function formatKontonummer(input: string): string {
  const digits = normalizeKontonummer(input);
  if (digits.length !== 11) return input;
  return `${digits.slice(0, 4)} ${digits.slice(4, 6)} ${digits.slice(6)}`;
}
