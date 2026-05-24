import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { markRead } from '../../../lib/services/notifications';

export const POST: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Forbidden', { status: 403 });

  // Accept either form-data or JSON. Used as a navigator.sendBeacon-friendly
  // fire-and-forget endpoint, so we keep it tiny.
  const ct = request.headers.get('content-type') ?? '';
  let id = '';
  if (ct.includes('application/json')) {
    try { id = (await request.json())?.id ?? ''; } catch {}
  } else {
    const form = await request.formData();
    id = form.get('id')?.toString() ?? '';
  }

  const result = await markRead(ctx, { id });
  return new Response(null, { status: result.ok ? 204 : 400 });
};
