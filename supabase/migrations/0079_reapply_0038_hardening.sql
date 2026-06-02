-- Reconcile a PARTIAL application of 0038_security_hardening on production.
--
-- A `supabase db diff --linked` (2026-06-02) revealed prod drifted from the
-- migration files: it has the OLD (0015) commission UPDATE policies, the
-- pre-trust-gating handle_new_report(), and the old increment_moderator_stats
-- overload. Only 0038 §1 (profiles self-escalation WITH CHECK) actually landed
-- on prod — §2-6 did not (likely a statement errored mid-script in the
-- dashboard SQL editor and the rest never ran).
--
-- Impact of the gap on prod (now being closed):
--   * commission_requests / commission_offers had loose UPDATE policies with no
--     WITH CHECK, so an authenticated buyer/knitter could directly PATCH their
--     own rows via PostgREST (status, platform_fee_nok, awarded_offer_id, offer
--     status) bypassing the service-layer state machine.
--   * handle_new_report() counted ALL reports toward auto-hide, letting
--     low-trust accounts collectively suppress listings.
--
-- This migration re-applies 0038 §2-6 VERBATIM and idempotently (DROP ... IF
-- EXISTS / CREATE OR REPLACE). It is a safe no-op on any database that already
-- has those applied (e.g. local), and brings prod up to the intended state.
--
-- 0038 §1 (profiles self-escalation) is INTENTIONALLY OMITTED: it was already
-- on prod (the diff didn't flag it), AND 0072_split_profiles later moved
-- stripe_account_id / stripe_onboarded OFF profiles and recreated that policy
-- without them. Re-applying 0038's original §1 here would reference columns
-- that no longer exist and would *downgrade* the post-0072 policy. Leave it.

------------------------------------------------------------
-- §2 commission_requests UPDATE — buyer may edit descriptive fields only,
--    while open/pending_review; all status/payment/award fields pinned.
------------------------------------------------------------
DROP POLICY IF EXISTS "Buyer updates own requests" ON public.commission_requests;
CREATE POLICY "Buyer updates own requests"
  ON public.commission_requests FOR UPDATE
  USING (auth.uid() = buyer_id AND status IN ('open', 'pending_review'))
  WITH CHECK (
    auth.uid() = buyer_id
    AND status IS NOT DISTINCT FROM (SELECT status FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND stripe_payment_intent_id IS NOT DISTINCT FROM (SELECT stripe_payment_intent_id FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND stripe_transfer_id IS NOT DISTINCT FROM (SELECT stripe_transfer_id FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND platform_fee_nok IS NOT DISTINCT FROM (SELECT platform_fee_nok FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND awarded_offer_id IS NOT DISTINCT FROM (SELECT awarded_offer_id FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND reviewed_by IS NOT DISTINCT FROM (SELECT reviewed_by FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND reviewed_at IS NOT DISTINCT FROM (SELECT reviewed_at FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND moderation_notes IS NOT DISTINCT FROM (SELECT moderation_notes FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND review_deadline_at IS NOT DISTINCT FROM (SELECT review_deadline_at FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND report_count IS NOT DISTINCT FROM (SELECT report_count FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
  );

------------------------------------------------------------
-- §3 commission_offers UPDATE — knitter may only withdraw a pending offer.
------------------------------------------------------------
DROP POLICY IF EXISTS "Knitter updates own offers" ON public.commission_offers;
DROP POLICY IF EXISTS "Knitter withdraws own pending offers" ON public.commission_offers;
CREATE POLICY "Knitter withdraws own pending offers"
  ON public.commission_offers FOR UPDATE
  USING (auth.uid() = knitter_id AND status = 'pending')
  WITH CHECK (auth.uid() = knitter_id AND status = 'withdrawn');

------------------------------------------------------------
-- §4 commission_offers buyer-side UPDATE — remove entirely (service-role only).
------------------------------------------------------------
DROP POLICY IF EXISTS "Buyer updates offers on own requests" ON public.commission_offers;

------------------------------------------------------------
-- §5 handle_new_report() — only trusted/established reports count toward auto-hide.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_report()
RETURNS trigger AS $$
DECLARE
  credible_count integer;
BEGIN
  SELECT count(*) INTO credible_count
  FROM public.reports r
  JOIN public.profiles p ON p.id = r.reporter_id
  WHERE r.target_type = NEW.target_type
    AND r.target_id = NEW.target_id
    AND r.status = 'open'
    AND p.trust_tier IN ('established', 'trusted');

  IF NEW.target_type = 'listing' THEN
    UPDATE public.listings SET report_count = report_count + 1 WHERE id = NEW.target_id::uuid;
    IF credible_count >= 3 THEN
      UPDATE public.listings SET status = 'removed' WHERE id = NEW.target_id::uuid AND status = 'active';
    END IF;
  ELSIF NEW.target_type = 'commission_request' THEN
    UPDATE public.commission_requests SET report_count = report_count + 1 WHERE id = NEW.target_id::uuid;
    IF credible_count >= 3 THEN
      UPDATE public.commission_requests SET status = 'cancelled' WHERE id = NEW.target_id::uuid AND status IN ('open', 'pending_review');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

------------------------------------------------------------
-- §6 increment_moderator_stats() — atomic stats RPC (SECURITY DEFINER).
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_moderator_stats(
  p_user_id uuid,
  p_field   text,
  p_amount  numeric DEFAULT 1
)
RETURNS void AS $$
BEGIN
  EXECUTE format(
    'UPDATE public.moderator_stats SET %I = COALESCE(%I, 0) + $1 WHERE user_id = $2',
    p_field, p_field
  ) USING p_amount, p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
