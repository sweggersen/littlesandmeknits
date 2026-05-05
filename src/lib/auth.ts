import type { AstroCookies } from 'astro';
import type { User } from '@supabase/supabase-js';
import { createServerSupabase } from './supabase';

export async function getCurrentUser(opts: {
  request: Request;
  cookies: AstroCookies;
}): Promise<User | null> {
  try {
    const supabase = createServerSupabase(opts);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}
