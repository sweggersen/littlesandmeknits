import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createBrowserClient } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';

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
}): SupabaseClient {
  assertConfigured();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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

export function createBrowserSupabase(): SupabaseClient {
  assertConfigured();
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export function createAdminSupabase(serviceRoleKey: string): SupabaseClient {
  assertConfigured();
  // Use the service-role key — bypasses RLS. Only call from trusted server code
  // (webhook handlers, admin endpoints). Never expose this key to the browser.
  return createServerClient(SUPABASE_URL, serviceRoleKey, {
    cookies: {
      getAll: () => [],
      setAll: () => {},
    },
  });
}
