-- In-app notification system.
-- Notifications are always inserted server-side via the admin (service role) client,
-- so there is no INSERT policy for authenticated users.

create type public.notification_type as enum (
  'new_offer', 'offer_accepted', 'offer_declined',
  'payment_received', 'project_update', 'new_message',
  'yarn_shipped', 'yarn_received', 'commission_completed'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  body text,
  url text,
  actor_id uuid references public.profiles(id) on delete set null,
  reference_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_user on public.notifications(user_id, created_at desc);
create index idx_notifications_unread on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;

create policy "Users read own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "Users mark own notifications read"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
