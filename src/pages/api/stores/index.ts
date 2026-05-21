// POST /api/stores — create a store
// Accepts JSON or form data; returns JSON. Used by both the web wizard
// and (later) the mobile app.
import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { createStore } from '../../../lib/services/stores';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const contentType = request.headers.get('content-type') ?? '';
  let body: Record<string, string>;
  if (contentType.includes('application/json')) {
    body = await request.json();
  } else {
    const form = await request.formData();
    body = Object.fromEntries([...form.entries()].map(([k, v]) => [k, v.toString()]));
  }

  const result = await createStore(ctx, {
    orgnr: body.orgnr ?? '',
    name: body.name,
    slug: body.slug,
    tagline: body.tagline,
    description: body.description,
    website_url: body.website_url,
    contact_email: body.contact_email,
  });

  // Honor redirects for HTML form submissions only
  const wantsRedirect = !contentType.includes('application/json');
  return toResponse(result, wantsRedirect ? redirect : undefined);
};
