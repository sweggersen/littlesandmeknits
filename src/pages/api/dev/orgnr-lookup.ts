import type { APIRoute } from 'astro';
import { lookupOrgnr } from '../../../lib/brreg';
import { devToolsBlocked } from '../../../lib/dev-guard';

// Dev-only Brønnøysund orgnr lookup. Use during the store creation flow
// build-out to verify the integration without going through the full UI.
//   GET /api/dev/orgnr-lookup?orgnr=924838053
export const GET: APIRoute = async ({ request, url }) => {
  const blocked = devToolsBlocked(request);
  if (blocked) return blocked;

  const orgnr = url.searchParams.get('orgnr');
  if (!orgnr) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_orgnr' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await lookupOrgnr(orgnr);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
};
