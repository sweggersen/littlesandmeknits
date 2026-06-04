import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { assertWithinQuota } from './quota';

// Contact/support requests (june26.md §2.3). Signed-in users file a request;
// staff handle them in the /admin/support inbox. RLS gates access; the role
// check on the staff paths is for clear errors + the admin-client read.

export const SUPPORT_CATEGORIES = ['kjop', 'salg', 'betaling', 'konto', 'annet'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_CATEGORY_LABEL: Record<SupportCategory, string> = {
  kjop: 'Kjøp',
  salg: 'Salg',
  betaling: 'Betaling og utbetaling',
  konto: 'Konto',
  annet: 'Annet',
};

export async function submitSupportRequest(
  ctx: ServiceContext,
  input: { category?: string; subject?: string; body?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  const body = (input.body ?? '').trim();
  if (body.length < 5) return fail('bad_input', 'Skriv litt mer så vi kan hjelpe deg.');
  if (body.length > 4000) return fail('bad_input', 'Meldingen er for lang (maks 4000 tegn).');

  const category = SUPPORT_CATEGORIES.includes(input.category as SupportCategory)
    ? (input.category as SupportCategory)
    : 'annet';
  const subject = (input.subject ?? '').trim().slice(0, 200) || null;

  // Light spam guard, consistent with other write paths (R2-9).
  const quota = await assertWithinQuota(ctx, 'support_request_create');
  if (quota) return quota;

  const { error } = await ctx.supabase.from('support_requests').insert({
    user_id: ctx.user.id,
    email: ctx.user.email ?? null,
    category,
    subject,
    body,
    status: 'open',
  });
  if (error) {
    console.error('support_requests insert failed', error);
    return fail('server_error', 'Kunne ikke sende meldingen. Prøv igjen.');
  }
  return ok({ redirect: '/hjelp?sent=1' });
}

async function ensureStaff(ctx: ServiceContext): Promise<boolean> {
  const { data } = await ctx.admin.from('profiles').select('role').eq('id', ctx.user.id).maybeSingle();
  return !!data && (data.role === 'admin' || data.role === 'moderator');
}

export interface SupportRow {
  id: string;
  user_id: string | null;
  email: string | null;
  category: string;
  subject: string | null;
  body: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  handled_note: string | null;
}

export async function listSupportRequests(
  ctx: ServiceContext,
): Promise<ServiceResult<{ open: SupportRow[]; resolved: SupportRow[] }>> {
  if (!(await ensureStaff(ctx))) return fail('forbidden', 'Krever moderator- eller admin-tilgang');

  const { data, error } = await ctx.admin
    .from('support_requests')
    .select('id, user_id, email, category, subject, body, status, created_at, resolved_at, handled_note')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return fail('server_error', 'Kunne ikke hente henvendelser');

  const rows = (data ?? []) as SupportRow[];
  return ok({
    open: rows.filter((r) => r.status === 'open'),
    resolved: rows.filter((r) => r.status === 'resolved').slice(0, 50),
  });
}

export async function resolveSupportRequest(
  ctx: ServiceContext,
  input: { id?: string; note?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.id) return fail('bad_input', 'Mangler id');
  if (!(await ensureStaff(ctx))) return fail('forbidden', 'Krever moderator- eller admin-tilgang');

  const { error } = await ctx.admin
    .from('support_requests')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolved_by: ctx.user.id,
      handled_note: (input.note ?? '').trim().slice(0, 1000) || null,
    })
    .eq('id', input.id);
  if (error) return fail('server_error', 'Kunne ikke oppdatere');
  return ok({ redirect: '/admin/support?resolved=1' });
}
