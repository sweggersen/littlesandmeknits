-- 0119: make the daily action quota atomic.
--
-- assertWithinQuota() (src/lib/services/quota.ts) was a read-check-write: SELECT
-- count → compare to the limit → upsert count+1. Under concurrency two requests
-- both read N and both write N+1, so the daily cap is bypassable by firing
-- requests in parallel (and the counter is clobbered). This is the ONLY throttle
-- on Stripe-session-minting (purchase_checkout, pattern_checkout), report
-- brigading, offer/message spam, etc.
--
-- Fix: a single atomic INSERT ... ON CONFLICT DO UPDATE that only increments
-- while under the limit, returning the new count (or -1 when at/over). The whole
-- statement is atomic, so concurrent callers serialize on the row lock and can't
-- both slip past the cap. Called via the service (service_role); user_id is
-- passed in (auth.uid() is null under service_role).

create or replace function public.bump_action_count(
  p_user_id uuid,
  p_action  text,
  p_day     date,
  p_limit   int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count int;
begin
  insert into public.user_action_counts (user_id, action, day, count)
  values (p_user_id, p_action, p_day, 1)
  on conflict (user_id, action, day)
  do update set count = user_action_counts.count + 1
    where user_action_counts.count < p_limit
  returning count into new_count;

  -- No row returned = the conflict row existed and was already at/over the
  -- limit (the DO UPDATE ... WHERE matched nothing). Signal over-limit.
  return coalesce(new_count, -1);
end;
$$;

-- Only the service (service_role) may bump counts; a direct anon/authenticated
-- caller must never be able to move its own quota.
revoke execute on function public.bump_action_count(uuid, text, date, int) from anon, authenticated, public;
grant execute on function public.bump_action_count(uuid, text, date, int) to service_role;
