-- Store the Stripe Checkout Session id on the commission request at pay time.
-- Commission payment uses AUTOMATIC capture, so the buyer's money is taken
-- before the DB reflects it; if the checkout.session.completed webhook is lost,
-- the request is stuck in awaiting_payment while the buyer is charged. Recording
-- the session id lets a cron reconcile pass re-check Stripe and self-heal.
alter table public.commission_requests
  add column if not exists stripe_checkout_session_id text;
