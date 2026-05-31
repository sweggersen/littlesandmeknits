import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { exportPersonalData } from '../../../lib/services/profile';

// GDPR Art. 15 (right of access) + Art. 20 (data portability).
// Streams the user's data dump as a JSON download.
export const GET: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Not signed in', { status: 401 });

  const result = await exportPersonalData(ctx);
  if (!result.ok) return new Response(result.message, { status: 500 });

  const body = JSON.stringify(result.data, null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="littlesandme-export-${ctx.user.id}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
};
