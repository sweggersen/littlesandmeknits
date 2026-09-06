import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { toResponse } from '../../../lib/services/response';
import { launchPreflight } from '../../../lib/services/preflight';
import { env } from '../../../lib/env';

// Admin-only JSON launch preflight — scriptable sibling of /admin/preflight.
// The service (launchPreflight) authorizes; the route just wires env + ctx.
// Reads secrets from lib/env (the worker runtime), NOT import.meta.env, since
// Cloudflare secrets live on cfEnv — but only presence/classification leaves.
export const GET: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const result = await launchPreflight(ctx, env as unknown as Record<string, string | undefined>);
  return toResponse(result);
};
