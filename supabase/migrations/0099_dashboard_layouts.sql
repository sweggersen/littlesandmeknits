-- dashboard_layouts: per-user saved arrangement (order + widget sizes) for the
-- editable dashboards. Today just the Strikketorget profile ("profile"); the
-- "studio" context is reserved for the Strikkestua landing (the "two homes, one
-- engine" merge) so both surfaces persist through the same table.
--
-- The layout was localStorage-only, which doesn't sync across devices and
-- vanishes when the browser is cleared. This is the durable home for it.
--
-- Shape of `layout` (validated in the service, not the DB): an ordered array of
--   [{ "widget": "<key>", "size": "s" | "m" | "l" }, ...]
-- The DB stays schema-light on the JSON so adding a widget key never needs a
-- migration.

create table public.dashboard_layouts (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  context    text not null check (context in ('profile', 'studio')),
  layout     jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, context)
);

alter table public.dashboard_layouts enable row level security;
revoke all on public.dashboard_layouts from anon;

-- Owner-only, all verbs. user_id is the only server-controlled column and it is
-- pinned by WITH CHECK, so a direct PostgREST caller (0085 blanket grant) can
-- neither read nor write another user's layout. No self-referential subquery
-- here, so no 42P17 recursion risk (unlike 0097's seller_profiles/listings).
create policy dashboard_layouts_owner_all on public.dashboard_layouts for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
