-- R2-9: per-user daily quotas on commerce write paths.
--
-- Prevents bot/griever flooding of createRequest, makeOffer, sendMessage.
-- Counts roll over at UTC midnight. A user hitting the cap gets a
-- 'conflict' from the service with a Norwegian message — not a hard
-- block, just back-pressure.
--
-- Design: one row per (user, action, day). Upserts increment via
-- ON CONFLICT. No background job needed — old rows just sit there
-- harmlessly and can be cleaned up later if storage becomes an issue.

begin;

create table public.user_action_counts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  day date not null,
  count integer not null default 0,
  primary key (user_id, action, day)
);

-- Index for the "old rows cleanup" cron we'll add later if needed.
create index user_action_counts_day_idx on public.user_action_counts(day);

alter table public.user_action_counts enable row level security;

-- Owner read-only. Service-role bypasses for writes (the quota helper
-- always uses ctx.admin so it can read+upsert in one round trip).
create policy "Owner reads own quota counts"
  on public.user_action_counts for select
  using (auth.uid() = user_id);

commit;
