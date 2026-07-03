import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// The typed Supabase client. Use TypedSupabaseClient instead of
// SupabaseClient everywhere. Re-exported for downstream service code
// that wants to type a stand-in (e.g. test mocks).
export type TypedSupabaseClient = SupabaseClient<Database>;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

function assertConfigured(): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Supabase env vars missing. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY.'
    );
  }
}

export function createServerSupabase(opts: {
  request: Request;
  cookies: AstroCookies;
}): TypedSupabaseClient {
  assertConfigured();
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        const header = opts.request.headers.get('Cookie') ?? '';
        return parseCookieHeader(header)
          .filter((c) => c.value !== undefined)
          .map((c) => ({ name: c.name, value: c.value as string }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          opts.cookies.set(name, value, options);
        }
      },
    },
  });
}

export function createBrowserSupabase(): TypedSupabaseClient {
  assertConfigured();
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/** A Supabase client authenticated by a Bearer access token instead of the SSR
 *  session cookie — the client an API/mobile consumer uses. PostgREST reads run
 *  under this user's JWT, so RLS applies exactly as it does for the cookie
 *  path. No session is persisted (each request carries its own token). */
export function createTokenSupabase(accessToken: string): TypedSupabaseClient {
  assertConfigured();
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createAdminSupabase(serviceRoleKey: string): TypedSupabaseClient {
  assertConfigured();
  // Use the service-role key — bypasses RLS. Only call from trusted server code
  // (webhook handlers, admin endpoints). Never expose this key to the browser.
  return createServerClient<Database>(SUPABASE_URL, serviceRoleKey, {
    cookies: {
      getAll: () => [],
      setAll: () => {},
    },
  });
}
