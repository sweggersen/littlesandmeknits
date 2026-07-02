-- Staff-review P2.6: consolidate the remaining inline role checks onto the
-- SECURITY DEFINER helpers (0037). The inline
--   EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role ...)
-- pattern reads profiles under the CALLER's grants — the exact mechanism
-- behind the 0077/0080 anon-scope outage. It works today only because 0085
-- restored broad authenticated table grants; these rewrites remove the
-- latent dependency. Semantics preserved exactly: admin-only policies use
-- is_admin(), mixed ones use is_admin_or_moderator().

-- ── mixed admin/moderator ──────────────────────────────────────────────
drop policy if exists "Admins and moderators read queue" on public.moderation_queue;
create policy "Admins and moderators read queue"
  on public.moderation_queue for select
  using (public.is_admin_or_moderator((select auth.uid())));

drop policy if exists "Admins and moderators read all reports" on public.reports;
create policy "Admins and moderators read all reports"
  on public.reports for select
  using (public.is_admin_or_moderator((select auth.uid())));

drop policy if exists "Admins and moderators read all listings" on public.listings;
create policy "Admins and moderators read all listings"
  on public.listings for select
  using (public.is_admin_or_moderator((select auth.uid())));

-- 0092 already created the helper-based "Staff read all commission_requests";
-- the 0037 inline twin is a duplicate — drop it rather than rewrite it.
drop policy if exists "Admins and moderators read all commission requests" on public.commission_requests;

drop policy if exists "Staff read dead-letter events" on public.dead_letter_events;
create policy "Staff read dead-letter events"
  on public.dead_letter_events for select
  using (public.is_admin_or_moderator((select auth.uid())));

drop policy if exists "Staff resolve dead-letter events" on public.dead_letter_events;
create policy "Staff resolve dead-letter events"
  on public.dead_letter_events for update
  using (public.is_admin_or_moderator((select auth.uid())));

-- ── admin-only (must NOT widen to moderators) ──────────────────────────
drop policy if exists "Admins read audit log" on public.moderation_audit_log;
create policy "Admins read audit log"
  on public.moderation_audit_log for select
  using (public.is_admin((select auth.uid())));

drop policy if exists "Admins read all moderator stats" on public.moderator_stats;
create policy "Admins read all moderator stats"
  on public.moderator_stats for select
  using (public.is_admin((select auth.uid())));

drop policy if exists "Admins read all payouts" on public.moderator_payouts;
create policy "Admins read all payouts"
  on public.moderator_payouts for select
  using (public.is_admin((select auth.uid())));
