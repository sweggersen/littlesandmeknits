// Granting achievements is a privileged system write — a user can't grant
// themselves via RLS — so it needs the service-role client. Wrapped here (admin
// built internally) so the badges page can trigger a "check & grant on view"
// without touching the admin client directly. Its own module (not lib/
// achievements.ts, which the cron also imports) so the static `env` import
// stays out of any unit-tested service graph.

import { createAdminSupabase } from '../supabase';
import { env } from '../env';
import { checkAndGrantAchievements } from '../achievements';

/** Grant any newly-earned achievements for the user (idempotent). */
export async function grantAchievementsOnView(userId: string): Promise<void> {
  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  await checkAndGrantAchievements(admin, userId, import.meta.env);
}
