-- Money-path failure alerting: every dead_letter_events row (a commerce
-- failure that couldn't be rolled back) now proactively notifies admins so it
-- can't sit unseen in the table until someone happens to open
-- /admin/dead-letters. New notification_type for those ops alerts; it reuses
-- the existing email_payment_received preference column (see EMAIL_PREF_COL in
-- src/lib/notify.ts), so no new preferences column is needed.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'system_alert';
