// GET /api/geo/address-search?q=... — thin proxy to Kartverket address search
// for the store address autocomplete. Server-side so it's immune to any app CSP
// and consistent with the other external-API proxies (orgnr-lookup). Returns a
// slim list of { text, postnummer, poststed }.
import type { APIRoute } from 'astro';
import { searchAddresses } from '../../../lib/geocode';

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q') ?? '';
  const hits = await searchAddresses(q, { limit: 8 });
  return new Response(JSON.stringify(hits), {
    headers: {
      'content-type': 'application/json',
      // Short private cache — suggestions are stable and non-sensitive.
      'cache-control': 'private, max-age=60',
    },
  });
};
