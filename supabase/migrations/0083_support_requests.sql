-- june26.md §2.3 — contact/support form storage. A generic "contact us" that
-- doesn't fit moderation_threads (no item/recipient), so it gets its own table
-- + a staff inbox at /admin/support.

create table if not exists public.support_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  email       text,
  category    text not null default 'annet',
  subject     text,
  body        text not null,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  handled_note text
);

alter table public.support_requests enable row level security;

-- No anon access (keeps the 0078 hardened posture); the public help page shows
-- a mailto fallback for logged-out visitors.
revoke all on public.support_requests from anon;

-- A signed-in user files their own request...
create policy "support_requests insert own"
  on public.support_requests for insert to authenticated
  with check (user_id = auth.uid());

-- ...and can read their own to see status.
create policy "support_requests read own"
  on public.support_requests for select to authenticated
  using (user_id = auth.uid());

-- Staff (admin/moderator) read + resolve everything.
create policy "support_requests staff read"
  on public.support_requests for select to authenticated
  using (public.is_admin_or_moderator(auth.uid()));

create policy "support_requests staff update"
  on public.support_requests for update to authenticated
  using (public.is_admin_or_moderator(auth.uid()));

create index if not exists idx_support_requests_open
  on public.support_requests(created_at desc) where status = 'open';
