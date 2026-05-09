-- Notification preferences: per-user email opt-out per notification type.
-- All default to true (opted in).

create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_new_offer boolean not null default true,
  email_offer_accepted boolean not null default true,
  email_offer_declined boolean not null default true,
  email_payment_received boolean not null default true,
  email_project_update boolean not null default true,
  email_new_message boolean not null default true,
  email_yarn_shipped boolean not null default true,
  email_yarn_received boolean not null default true,
  email_commission_completed boolean not null default true,
  email_commission_delivered boolean not null default true,
  email_request_expired boolean not null default true,
  push_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy "Users manage own preferences"
  on public.notification_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
