-- Cron liveness (dead-man's-switch, in-our-control half).
--
-- The dead_letter alerting (0091) catches failures DURING a cron run, but not
-- the cron ceasing to run at all — which is exactly the original incident:
-- cron-job.org auto-disabled the job after 26 consecutive failures, silently
-- halting escrow auto-release for everyone. No execution = no error = silence.
--
-- The cron now upserts a heartbeat row at the end of every run. The admin
-- dashboard reads it and flags a STALE last-run (see src/lib/cron-health.ts),
-- so a halted cron is visible the moment staff open /admin. The proactive
-- (push) half is an external dead-man's-switch (healthchecks.io) the cron pings
-- when CRON_HEARTBEAT_URL is set — if the pings stop, that service alerts.

create table public.cron_heartbeats (
  name text primary key,              -- 'main' for the main scheduled run
  last_run_at timestamptz not null,
  ok boolean not null,                -- false when the run had section errors
  error_count int not null default 0,
  duration_ms int,
  results jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.cron_heartbeats enable row level security;
revoke all on public.cron_heartbeats from anon;

-- Staff-only read (mirrors dead_letter_events). The SECURITY DEFINER helper
-- (0037) never reads profiles under the caller's grants. No INSERT/UPDATE
-- policy: only the service-role cron writes it.
create policy cron_heartbeats_staff_read on public.cron_heartbeats for select to authenticated
  using (public.is_admin_or_moderator((select auth.uid())));
