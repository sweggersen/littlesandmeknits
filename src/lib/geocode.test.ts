import { describe, it, expect, vi } from 'vitest';
import { parseKartverketPoint, haversineKm, geocodePostnummer, parseAddressHits, searchAddresses } from './geocode';

describe('parseKartverketPoint', () => {
  it('pulls the first representasjonspunkt', () => {
    const json = { adresser: [{ representasjonspunkt: { lat: 59.91, lon: 10.75 } }] };
    expect(parseKartverketPoint(json)).toEqual({ lat: 59.91, lng: 10.75 });
  });

  it('returns null on an empty or malformed response', () => {
    expect(parseKartverketPoint({ adresser: [] })).toBeNull();
    expect(parseKartverketPoint({})).toBeNull();
    expect(parseKartverketPoint(null)).toBeNull();
    expect(parseKartverketPoint({ adresser: [{ representasjonspunkt: { lat: 'x', lon: 1 } }] })).toBeNull();
  });
});

describe('haversineKm', () => {
  it('is ~0 for the same point', () => {
    expect(haversineKm({ lat: 59.91, lng: 10.75 }, { lat: 59.91, lng: 10.75 })).toBeCloseTo(0, 5);
  });

  it('Oslo→Bergen is roughly 300 km', () => {
    const d = haversineKm({ lat: 59.91, lng: 10.75 }, { lat: 60.39, lng: 5.32 });
    expect(d).toBeGreaterThan(250);
    expect(d).toBeLessThan(350);
  });
});

describe('geocodePostnummer', () => {
  it('rejects a non-4-digit postnummer without a network call', async () => {
    const fetchMock = vi.fn();
    expect(await geocodePostnummer('12', 'Oslo', { fetch: fetchMock as unknown as typeof fetch })).toBeNull();
    expect(await geocodePostnummer('', null, { fetch: fetchMock as unknown as typeof fetch })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('queries only the postnummer (never a street address) and parses the hit', async () => {
    const fetchMock = vi.fn(async (urlStr: string) => {
      // Coarse by construction: the request carries postnummer, not a street.
      expect(urlStr).toContain('postnummer=0123');
      expect(urlStr).not.toMatch(/gate|adresse=/i);
      return new Response(JSON.stringify({ adresser: [{ representasjonspunkt: { lat: 59.9, lon: 10.7 } }] }), {
        status: 200,
      });
    });
    const point = await geocodePostnummer('0123', 'Oslo', { fetch: fetchMock as unknown as typeof fetch });
    expect(point).toEqual({ lat: 59.9, lng: 10.7 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('returns null (never throws) on a network failure', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('offline'); });
    expect(await geocodePostnummer('0123', 'Oslo', { fetch: fetchMock as unknown as typeof fetch })).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    expect(await geocodePostnummer('0123', 'Oslo', { fetch: fetchMock as unknown as typeof fetch })).toBeNull();
  });
});

describe('parseAddressHits', () => {
  it('maps hits and title-cases the uppercase poststed', () => {
    const json = { adresser: [
      { adressetekst: 'Karl Johans gate 1', postnummer: '0154', poststed: 'OSLO' },
      { adressetekst: 'Storgata 2', postnummer: '2003', poststed: 'NORDRE LILLESTRØM' },
    ] };
    expect(parseAddressHits(json)).toEqual([
      { text: 'Karl Johans gate 1', postnummer: '0154', poststed: 'Oslo' },
      { text: 'Storgata 2', postnummer: '2003', poststed: 'Nordre Lillestrøm' },
    ]);
  });

  it('drops hits without a 4-digit postnummer or text', () => {
    const json = { adresser: [
      { adressetekst: '', postnummer: '0154', poststed: 'OSLO' },
      { adressetekst: 'Gate 1', postnummer: '12', poststed: 'X' },
      { adressetekst: 'Gate 2', poststed: 'X' },
    ] };
    expect(parseAddressHits(json)).toEqual([]);
  });

  it('returns [] on a malformed response', () => {
    expect(parseAddressHits({})).toEqual([]);
    expect(parseAddressHits(null)).toEqual([]);
  });
});

describe('searchAddresses', () => {
  it('skips the network for queries under 3 chars', async () => {
    const fetchMock = vi.fn();
    expect(await searchAddresses('ka', { fetch: fetchMock as unknown as typeof fetch })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('queries and parses hits', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      adresser: [{ adressetekst: 'Storgata 1', postnummer: '0155', poststed: 'OSLO' }],
    }), { status: 200 }));
    const hits = await searchAddresses('Storgata 1 Oslo', { fetch: fetchMock as unknown as typeof fetch });
    expect(hits).toEqual([{ text: 'Storgata 1', postnummer: '0155', poststed: 'Oslo' }]);
  });

  it('returns [] (never throws) on failure', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('offline'); });
    expect(await searchAddresses('Storgata 1', { fetch: fetchMock as unknown as typeof fetch })).toEqual([]);
  });
});
