-- H2b: commissions move to separate charges & transfers (the buyer is charged
-- in full at payment, funds sit in the platform balance, and the knitter's
-- share is transferred at delivery). Record the Stripe transfer id for
-- audit/support. Not sensitive (an opaque Stripe id); readable under the
-- existing commission_requests row policies (parties + staff), already
-- covered by the RLS suite.
ALTER TABLE public.commission_requests
  ADD COLUMN IF NOT EXISTS stripe_transfer_id text;
