-- Add awaiting_yarn status for commissions where buyer sends yarn.
-- MUST run alone (and commit) before 0022, because Postgres cannot
-- reference a new enum value in the same transaction that adds it.

alter type public.commission_request_status add value 'awaiting_yarn' before 'awarded';
