import type { APIRoute } from 'astro';
import { requireCtx, json } from '../../../lib/api/v1';

// GET /api/v1/me — the authenticated user + their profile. Reads via the
// RLS-respecting client, so this doubles as the token-auth smoke: a valid
// Bearer token resolves the user and returns their own row; anything else 401s.
export const GET: APIRoute = async ({ request, cookies }) => {
  const ctx = await requireCtx(request, cookies);
  if (ctx instanceof Response) return ctx;

  const { data: profile } = await ctx.supabase
    .from('profiles')
    .select('id, display_name, role, trust_tier, trust_score, avatar_path, location')
    .eq('id', ctx.user.id)
    .maybeSingle();

  return json({ user: { id: ctx.user.id, email: ctx.user.email }, profile });
};
