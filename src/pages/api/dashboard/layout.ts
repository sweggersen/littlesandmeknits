import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { toResponse } from '../../../lib/services/response';
import {
  saveDashboardLayout,
  resetDashboardLayout,
  type DashboardContext,
} from '../../../lib/services/dashboard-layout';

// Persist / clear the editable dashboard arrangement for the current user.
// The service validates the context + layout shape and RLS pins user_id.

export const POST: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const body = await request.json().catch(() => null);
  const context = (body?.context ?? 'profile') as DashboardContext;
  const result = await saveDashboardLayout(ctx, { context, layout: body?.layout });
  return toResponse(result);
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const body = await request.json().catch(() => null);
  const context = (body?.context ?? 'profile') as DashboardContext;
  const result = await resetDashboardLayout(ctx, context);
  return toResponse(result);
};
