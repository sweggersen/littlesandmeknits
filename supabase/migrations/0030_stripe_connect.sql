-- Stripe Connect fields for seller onboarding and escrow payments.

alter table public.profiles
  add column if not exists stripe_account_id text,
  add column if not exists stripe_onboarded boolean not null default false;

alter table public.commission_requests
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_transfer_id text,
  add column if not exists platform_fee_nok int;
