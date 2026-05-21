// Authenticated orgnr lookup. Used by the store creation wizard so the
// user sees a preview of legal name/address before submitting.
import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { lookupOrgnr } from '../../../lib/brreg';

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const orgnr = url.searchParams.get('orgnr');
  if (!orgnr) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_orgnr' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  const result = await lookupOrgnr(orgnr);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
};
