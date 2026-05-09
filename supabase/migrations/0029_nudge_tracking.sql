-- Track when last nudge was sent for stale commissions.

alter table public.commission_requests
  add column if not exists last_nudge_sent_at timestamptz;
