-- Security hardening: RLS WITH CHECK gaps + trust-gated auto-hide trigger.
-- Depends on 0037_moderation_system.sql (trust_tier, trust_score, stripe_account_id,
-- stripe_onboarded, report_count, moderation_notes, etc. must all exist).

------------------------------------------------------------
-- 1. profiles UPDATE — prevent self-escalation (CRITICAL)
--
-- The old policy had no WITH CHECK, so any authenticated user could
-- write arbitrary values to role, trust_score, stripe_account_id, etc.
-- The new policy pins those columns to their current DB values so that
-- only fields legitimately editable by the user are writable.
-- Pinned:  role, trust_score, trust_tier, total_completed_transactions,
--          total_rejections, stripe_account_id, stripe_onboarded.
-- Editable: display_name, bio, location, avatar_path, instagram_handle,
--           seller_tags, language (and any other non-sensitive columns).
------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- role must not change
    AND role IS NOT DISTINCT FROM (SELECT role FROM public.profiles p WHERE p.id = profiles.id)
    -- trust_score must not change
    AND trust_score IS NOT DISTINCT FROM (SELECT trust_score FROM public.profiles p WHERE p.id = profiles.id)
    -- trust_tier must not change
    AND trust_tier IS NOT DISTINCT FROM (SELECT trust_tier FROM public.profiles p WHERE p.id = profiles.id)
    -- total_completed_transactions must not change
    AND total_completed_transactions IS NOT DISTINCT FROM (SELECT total_completed_transactions FROM public.profiles p WHERE p.id = profiles.id)
    -- total_rejections must not change
    AND total_rejections IS NOT DISTINCT FROM (SELECT total_rejections FROM public.profiles p WHERE p.id = profiles.id)
    -- stripe_account_id must not change
    AND stripe_account_id IS NOT DISTINCT FROM (SELECT stripe_account_id FROM public.profiles p WHERE p.id = profiles.id)
    -- stripe_onboarded must not change
    AND stripe_onboarded IS NOT DISTINCT FROM (SELECT stripe_onboarded FROM public.profiles p WHERE p.id = profiles.id)
  );

------------------------------------------------------------
-- 2. commission_requests UPDATE — restrict buyer writes
--
-- Old policy: using(auth.uid() = buyer_id) with no WITH CHECK.
-- New policy: buyer may only edit descriptive fields while the request
-- is still open or pending_review. All status transitions and
-- payment/moderation fields are managed exclusively by the service role
-- via API routes and are pinned here.
------------------------------------------------------------
DROP POLICY IF EXISTS "Buyer updates own requests" ON public.commission_requests;

CREATE POLICY "Buyer updates own requests"
  ON public.commission_requests FOR UPDATE
  USING (auth.uid() = buyer_id AND status IN ('open', 'pending_review'))
  WITH CHECK (
    auth.uid() = buyer_id
    -- status must not change (all transitions go through the API/service role)
    AND status IS NOT DISTINCT FROM (SELECT status FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    -- payment fields must not change
    AND stripe_payment_intent_id IS NOT DISTINCT FROM (SELECT stripe_payment_intent_id FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND stripe_transfer_id IS NOT DISTINCT FROM (SELECT stripe_transfer_id FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND platform_fee_nok IS NOT DISTINCT FROM (SELECT platform_fee_nok FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    -- award and moderation fields must not change
    AND awarded_offer_id IS NOT DISTINCT FROM (SELECT awarded_offer_id FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND reviewed_by IS NOT DISTINCT FROM (SELECT reviewed_by FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND reviewed_at IS NOT DISTINCT FROM (SELECT reviewed_at FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND moderation_notes IS NOT DISTINCT FROM (SELECT moderation_notes FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND review_deadline_at IS NOT DISTINCT FROM (SELECT review_deadline_at FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
    AND report_count IS NOT DISTINCT FROM (SELECT report_count FROM public.commission_requests cr WHERE cr.id = commission_requests.id)
  );

------------------------------------------------------------
-- 3. commission_offers UPDATE — restrict knitter to withdraw only
--
-- Old policy: using(auth.uid() = knitter_id) with no WITH CHECK.
-- The knitter's only legitimate direct action is withdrawing a pending
-- offer. All other state transitions (acceptance, delivery confirmation,
-- etc.) are handled server-side via the service role.
------------------------------------------------------------
DROP POLICY IF EXISTS "Knitter updates own offers" ON public.commission_offers;

CREATE POLICY "Knitter withdraws own pending offers"
  ON public.commission_offers FOR UPDATE
  USING (auth.uid() = knitter_id AND status = 'pending')
  WITH CHECK (
    auth.uid() = knitter_id
    AND status = 'withdrawn'
  );

------------------------------------------------------------
-- 4. commission_offers buyer-side UPDATE — remove entirely
--
-- Old policy allowed buyers to directly update offer rows. All
-- offer acceptance and declining now goes through the API using the
-- service role, so no client-side UPDATE policy is needed.
------------------------------------------------------------
DROP POLICY IF EXISTS "Buyer updates offers on own requests" ON public.commission_offers;

------------------------------------------------------------
-- 5. handle_new_report() — trust-gated auto-hide
--
-- Previous implementation counted ALL reports toward the auto-hide
-- threshold (3), allowing low-trust accounts to collectively suppress
-- legitimate listings/requests. The updated function:
--   - Still increments report_count for every report (audit trail).
--   - Only counts reports from 'established' or 'trusted' users toward
--     the auto-hide threshold of 3.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_report()
RETURNS trigger AS $$
DECLARE
  credible_count integer;
BEGIN
  -- Count credible reports (established/trusted tier only) for this target
  SELECT count(*) INTO credible_count
  FROM public.reports r
  JOIN public.profiles p ON p.id = r.reporter_id
  WHERE r.target_type = NEW.target_type
    AND r.target_id = NEW.target_id
    AND r.status = 'open'
    AND p.trust_tier IN ('established', 'trusted');

  IF NEW.target_type = 'listing' THEN
    -- Always bump the raw report count
    UPDATE public.listings
      SET report_count = report_count + 1
      WHERE id = NEW.target_id::uuid;
    -- Auto-hide only when 3+ credible reports
    IF credible_count >= 3 THEN
      UPDATE public.listings
        SET status = 'removed'
        WHERE id = NEW.target_id::uuid AND status = 'active';
    END IF;

  ELSIF NEW.target_type = 'commission_request' THEN
    UPDATE public.commission_requests
      SET report_count = report_count + 1
      WHERE id = NEW.target_id::uuid;
    IF credible_count >= 3 THEN
      UPDATE public.commission_requests
        SET status = 'cancelled'
        WHERE id = NEW.target_id::uuid AND status IN ('open', 'pending_review');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

------------------------------------------------------------
-- 6. increment_moderator_stats() — atomic stats RPC
--
-- Provides a SECURITY DEFINER RPC so that API routes can atomically
-- increment moderator stat counters without granting clients direct
-- UPDATE access to the moderator_stats table. The p_field parameter
-- is the column name (e.g. 'total_reviews', 'total_approvals').
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
