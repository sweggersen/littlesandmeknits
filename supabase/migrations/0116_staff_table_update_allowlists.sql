-- 0116: least-privilege for the two staff-gated USING-only UPDATE tables, so a
-- moderator/admin can resolve a record but cannot rewrite the audit trail
-- itself. Same class as 0114/0115, lower severity (staff are trusted), but
-- audit-record integrity on a money/moderation platform is worth pinning.
--
-- Both UPDATE policies are is_admin_or_moderator(...) with no WITH CHECK, and
-- `authenticated` held a table-wide UPDATE grant, so a staff member could alter
-- any column — e.g. a dead_letter_event's original service/error/context/user_id
-- (hide evidence) or a support_request's email/body/user_id (falsify a user's
-- complaint).
--
-- Fix: column allowlist of the resolution fields only.
--   * dead_letter_events — resolveDeadLetter() updates via the RLS (cookie)
--     client, so authenticated needs UPDATE on exactly the three resolution
--     columns; every original-event column becomes read-only.
--   * support_requests — resolveSupportRequest() updates via the service
--     (service_role, exempt from these grants), so authenticated needs NO direct
--     UPDATE at all. The staff-only RLS policy remains as a second gate.

begin;

-- dead_letter_events: staff may only mark an event resolved.
revoke update on public.dead_letter_events from anon, authenticated;
grant update (resolved_at, resolved_by, resolution_note)
  on public.dead_letter_events to authenticated;

-- support_requests: no direct authenticated UPDATE (resolution goes through the
-- service). Users still INSERT their own request via the existing INSERT policy.
revoke update on public.support_requests from anon, authenticated;

commit;
