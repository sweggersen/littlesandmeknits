import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidOrgnr, normalizeOrgnr, lookupOrgnr } from './brreg';

describe('normalizeOrgnr', () => {
  it('strips spaces, dashes, and other separators', () => {
    expect(normalizeOrgnr('971 524 960')).toBe('971524960');
    expect(normalizeOrgnr('971-524-960')).toBe('971524960');
    expect(normalizeOrgnr(' 971524960 ')).toBe('971524960');
    expect(normalizeOrgnr('NO971524960')).toBe('971524960');
  });
});

describe('isValidOrgnr', () => {
  it('accepts valid orgnr with correct MOD11 checksum', () => {
    // 971524960 is a real, well-known orgnr (Stortinget)
    expect(isValidOrgnr('971524960')).toBe(true);
  });

  it('rejects orgnr with wrong checksum', () => {
    expect(isValidOrgnr('924838050')).toBe(false);
    expect(isValidOrgnr('123456789')).toBe(false);
  });

  it('rejects strings that are not 9 digits', () => {
    expect(isValidOrgnr('12345678')).toBe(false);
    expect(isValidOrgnr('1234567890')).toBe(false);
    expect(isValidOrgnr('abc123456')).toBe(false);
    expect(isValidOrgnr('')).toBe(false);
  });
});

describe('lookupOrgnr', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns invalid_format for non-numeric input', async () => {
    const result = await lookupOrgnr('not a number');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_format');
  });

  it('returns invalid_checksum for syntactically-valid but checksum-failing orgnr', async () => {
    const result = await lookupOrgnr('123456789');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_checksum');
  });

  it('returns not_found when Brønnøysund returns 404', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(new Response(null, { status: 404 }));
    const result = await lookupOrgnr('971524960');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');
  });

  it('maps a successful response into canonical OrgnrData', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          organisasjonsnummer: '971524960',
          navn: 'TEST AS',
          organisasjonsform: { kode: 'AS', beskrivelse: 'Aksjeselskap' },
          stiftelsesdato: '2020-01-15',
          forretningsadresse: {
            adresse: ['Storgata 1'],
            postnummer: '0155',
            poststed: 'OSLO',
          },
          naeringskode1: { kode: '47.71', beskrivelse: 'Butikkhandel med klær' },
        }),
        { status: 200 },
      ),
    );
    const result = await lookupOrgnr('971524960');
    expect(result.ok).toBe(true);
    expect(result.data?.legalName).toBe('TEST AS');
    expect(result.data?.businessType).toBe('AS');
    expect(result.data?.city).toBe('OSLO');
    expect(result.data?.address).toContain('Storgata 1');
    expect(result.data?.status).toBe('normal');
  });

  it('reports bankrupt status when konkurs is true', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          organisasjonsnummer: '971524960',
          navn: 'TEST AS',
          organisasjonsform: { kode: 'AS', beskrivelse: 'Aksjeselskap' },
          konkurs: true,
        }),
        { status: 200 },
      ),
    );
    const result = await lookupOrgnr('971524960');
    expect(result.data?.status).toBe('bankrupt');
  });

  it('reports deleted status when slettedato is set', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          organisasjonsnummer: '971524960',
          navn: 'TEST AS',
          organisasjonsform: { kode: 'AS', beskrivelse: 'Aksjeselskap' },
          slettedato: '2024-06-01',
        }),
        { status: 200 },
      ),
    );
    const result = await lookupOrgnr('971524960');
    expect(result.data?.status).toBe('deleted');
  });
});
