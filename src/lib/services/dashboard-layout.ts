import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import type { Json } from '../database.types';

// Persisted arrangement of the editable dashboards. See migration 0099.

export type DashboardContext = 'profile' | 'studio';
export interface DashboardLayoutItem {
  widget: string;
  size: 's' | 'm' | 'l';
}

const VALID_CONTEXTS = new Set<DashboardContext>(['profile', 'studio']);
const VALID_SIZES = new Set(['s', 'm', 'l']);
// Widget keys are slugs owned by the page templates; we don't hardcode the set
// here (so adding a widget needs no service change) but we bound length/shape so
// a caller can't stuff arbitrary blobs into the row.
const WIDGET_KEY = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const MAX_ITEMS = 32;

// Coerce untrusted input into a clean layout array, or null if it's not a
// sane layout at all. Drops unrecognisably-shaped items rather than throwing,
// but rejects the whole payload if it isn't an array.
export function sanitizeLayout(raw: unknown): DashboardLayoutItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DashboardLayoutItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (out.length >= MAX_ITEMS) break;
    if (!entry || typeof entry !== 'object') continue;
    const widget = (entry as Record<string, unknown>).widget;
    const size = (entry as Record<string, unknown>).size;
    if (typeof widget !== 'string' || !WIDGET_KEY.test(widget)) continue;
    if (typeof size !== 'string' || !VALID_SIZES.has(size)) continue;
    if (seen.has(widget)) continue; // one entry per widget
    seen.add(widget);
    out.push({ widget, size: size as 's' | 'm' | 'l' });
  }
  return out;
}

export async function getDashboardLayout(
  ctx: ServiceContext,
  context: DashboardContext,
): Promise<ServiceResult<{ layout: DashboardLayoutItem[] }>> {
  if (!VALID_CONTEXTS.has(context)) return fail('bad_input', 'Invalid dashboard context');

  const { data, error } = await ctx.supabase
    .from('dashboard_layouts')
    .select('layout')
    .eq('user_id', ctx.user.id)
    .eq('context', context)
    .maybeSingle();

  if (error) {
    console.error('Load dashboard layout failed', error);
    return fail('server_error', 'Could not load layout');
  }
  return ok({ layout: sanitizeLayout(data?.layout) ?? [] });
}

export async function saveDashboardLayout(
  ctx: ServiceContext,
  input: { context: DashboardContext; layout: unknown },
): Promise<ServiceResult<{ layout: DashboardLayoutItem[] }>> {
  if (!VALID_CONTEXTS.has(input.context)) return fail('bad_input', 'Invalid dashboard context');
  const layout = sanitizeLayout(input.layout);
  if (!layout) return fail('bad_input', 'Layout must be an array');

  // Owner-scoped upsert. RLS pins user_id, but we set it explicitly so a stale
  // row for another user can never be targeted by the (user_id, context) key.
  const { error } = await ctx.supabase
    .from('dashboard_layouts')
    .upsert(
      // layout is a plain array of {widget,size} — valid JSON at runtime, but the
      // generated column type is the opaque `Json`, which a typed interface can't
      // structurally satisfy (no index signature). Narrow cast, not `as any`.
      { user_id: ctx.user.id, context: input.context, layout: layout as unknown as Json, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,context' },
    );

  if (error) {
    console.error('Save dashboard layout failed', error);
    return fail('server_error', 'Could not save layout');
  }
  return ok({ layout });
}

export async function resetDashboardLayout(
  ctx: ServiceContext,
  context: DashboardContext,
): Promise<ServiceResult<{ ok: true }>> {
  if (!VALID_CONTEXTS.has(context)) return fail('bad_input', 'Invalid dashboard context');

  const { error } = await ctx.supabase
    .from('dashboard_layouts')
    .delete()
    .eq('user_id', ctx.user.id)
    .eq('context', context);

  if (error) {
    console.error('Reset dashboard layout failed', error);
    return fail('server_error', 'Could not reset layout');
  }
  return ok({ ok: true });
}
