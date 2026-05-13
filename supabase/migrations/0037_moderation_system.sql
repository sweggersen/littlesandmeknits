-- Trust, safety & moderation system.
-- Run AFTER 0034-0036 have been committed.

------------------------------------------------------------
-- 1. Role enum + profile additions
------------------------------------------------------------
CREATE TYPE public.user_role AS ENUM ('admin', 'moderator', 'ambassador');

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role public.user_role,
  ADD COLUMN IF NOT EXISTS trust_score INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trust_tier TEXT NOT NULL DEFAULT 'new'
    CHECK (trust_tier IN ('new', 'established', 'trusted')),
  ADD COLUMN IF NOT EXISTS total_completed_transactions INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_rejections INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role) WHERE role IS NOT NULL;

------------------------------------------------------------
-- 2. Moderation queue
------------------------------------------------------------
CREATE TABLE public.moderation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type TEXT NOT NULL CHECK (item_type IN ('listing', 'commission_request')),
  item_id UUID NOT NULL,
  submitter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'assigned', 'approved', 'rejected', 'escalated')),
  decision_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  decision_at TIMESTAMPTZ,
  rejection_reason TEXT,
  internal_notes TEXT,
  shadow_review BOOLEAN NOT NULL DEFAULT FALSE,
  shadow_confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  shadow_confirmed_at TIMESTAMPTZ,
  shadow_decision_overridden BOOLEAN DEFAULT FALSE,
  spot_check BOOLEAN NOT NULL DEFAULT FALSE,
  spot_check_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  spot_check_at TIMESTAMPTZ,
  spot_check_agreed BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_moderation_queue_pending
  ON public.moderation_queue(status, created_at ASC)
  WHERE status IN ('pending', 'assigned', 'escalated');
CREATE INDEX idx_moderation_queue_submitter
  ON public.moderation_queue(submitter_id, status);
CREATE INDEX idx_moderation_queue_assigned
  ON public.moderation_queue(assigned_to)
  WHERE status = 'assigned';
CREATE INDEX idx_moderation_queue_shadow
  ON public.moderation_queue(shadow_review, status)
  WHERE shadow_review = TRUE AND shadow_confirmed_at IS NULL;
CREATE INDEX idx_moderation_queue_spot_check
  ON public.moderation_queue(spot_check)
  WHERE spot_check = TRUE AND spot_check_at IS NULL;
CREATE UNIQUE INDEX idx_moderation_queue_item
  ON public.moderation_queue(item_type, item_id)
  WHERE status IN ('pending', 'assigned');

CREATE TRIGGER moderation_queue_set_updated_at
  BEFORE UPDATE ON public.moderation_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.moderation_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and moderators read queue"
  ON public.moderation_queue FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'moderator')
    )
  );

CREATE POLICY "Submitters read own queue items"
  ON public.moderation_queue FOR SELECT
  USING (auth.uid() = submitter_id);

------------------------------------------------------------
-- 3. Moderation audit log
------------------------------------------------------------
CREATE TABLE public.moderation_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'approve', 'reject', 'escalate', 'auto_approve',
    'shadow_confirm', 'shadow_override',
    'spot_check_agree', 'spot_check_disagree',
    'report_resolve', 'report_dismiss',
    'auto_hide', 'manual_hide', 'manual_unhide',
    'role_grant', 'role_revoke',
    'trust_tier_change'
  )),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  queue_item_id UUID REFERENCES public.moderation_queue(id) ON DELETE SET NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_target ON public.moderation_audit_log(target_type, target_id);
CREATE INDEX idx_audit_log_actor ON public.moderation_audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_log_created ON public.moderation_audit_log(created_at DESC);

ALTER TABLE public.moderation_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit log"
  ON public.moderation_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Moderators read own audit entries"
  ON public.moderation_audit_log FOR SELECT
  USING (auth.uid() = actor_id);

------------------------------------------------------------
-- 4. Moderator stats
------------------------------------------------------------
CREATE TABLE public.moderator_stats (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_reviews INT NOT NULL DEFAULT 0,
  total_approvals INT NOT NULL DEFAULT 0,
  total_rejections INT NOT NULL DEFAULT 0,
  total_escalations INT NOT NULL DEFAULT 0,
  shadow_overrides INT NOT NULL DEFAULT 0,
  spot_check_disagreements INT NOT NULL DEFAULT 0,
  current_month_reviews INT NOT NULL DEFAULT 0,
  current_month_earned_nok DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_earned_nok DECIMAL(10,2) NOT NULL DEFAULT 0,
  rate_nok_per_review DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  last_review_at TIMESTAMPTZ,
  stats_reset_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER moderator_stats_set_updated_at
  BEFORE UPDATE ON public.moderator_stats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.moderator_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all moderator stats"
  ON public.moderator_stats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Moderators read own stats"
  ON public.moderator_stats FOR SELECT
  USING (auth.uid() = user_id);

------------------------------------------------------------
-- 5. Reports
------------------------------------------------------------
CREATE TYPE public.report_reason AS ENUM (
  'scam', 'inappropriate', 'wrong_category', 'spam', 'other'
);

CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('listing', 'commission_request', 'profile')),
  target_id UUID NOT NULL,
  reason public.report_reason NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT one_report_per_user_per_target UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX idx_reports_target ON public.reports(target_type, target_id);
CREATE INDEX idx_reports_open ON public.reports(status, created_at ASC) WHERE status = 'open';

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users create reports"
  ON public.reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Users read own reports"
  ON public.reports FOR SELECT
  USING (auth.uid() = reporter_id);

CREATE POLICY "Admins and moderators read all reports"
  ON public.reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'moderator')
    )
  );

------------------------------------------------------------
-- 6. Report count + moderation fields on existing tables
------------------------------------------------------------
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS report_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS moderation_notes TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.commission_requests
  ADD COLUMN IF NOT EXISTS report_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS moderation_notes TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_deadline_at TIMESTAMPTZ;

------------------------------------------------------------
-- 7. Bidirectional transaction reviews
------------------------------------------------------------
CREATE TABLE public.transaction_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_request_id UUID NOT NULL REFERENCES public.commission_requests(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role IN ('buyer', 'knitter')),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  visible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT one_review_per_role_per_commission
    UNIQUE (commission_request_id, reviewer_role)
);

CREATE INDEX idx_transaction_reviews_reviewee
  ON public.transaction_reviews(reviewee_id, visible) WHERE visible = TRUE;
CREATE INDEX idx_transaction_reviews_commission
  ON public.transaction_reviews(commission_request_id);

ALTER TABLE public.transaction_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone reads visible reviews"
  ON public.transaction_reviews FOR SELECT
  USING (visible = TRUE);

CREATE POLICY "Participants read own commission reviews"
  ON public.transaction_reviews FOR SELECT
  USING (auth.uid() = reviewer_id OR auth.uid() = reviewee_id);

CREATE POLICY "Verified participants insert reviews"
  ON public.transaction_reviews FOR INSERT
  WITH CHECK (
    auth.uid() = reviewer_id
    AND auth.uid() != reviewee_id
    AND EXISTS (
      SELECT 1 FROM public.commission_requests cr
      WHERE cr.id = commission_request_id
        AND cr.status = 'delivered'
    )
  );

------------------------------------------------------------
-- 8. Moderator payouts
------------------------------------------------------------
CREATE TABLE public.moderator_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  review_count INT NOT NULL,
  amount_nok DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.moderator_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all payouts"
  ON public.moderator_payouts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Moderators read own payouts"
  ON public.moderator_payouts FOR SELECT
  USING (auth.uid() = moderator_id);

------------------------------------------------------------
-- 9. RLS: admins/mods read all listings and commission requests
------------------------------------------------------------
CREATE POLICY "Admins and moderators read all listings"
  ON public.listings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'moderator')
    )
  );

CREATE POLICY "Admins and moderators read all commission requests"
  ON public.commission_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'moderator')
    )
  );

------------------------------------------------------------
-- 10. Helper functions
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin_or_moderator(uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = uid AND role IN ('admin', 'moderator')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = uid AND role = 'admin'
  );
$$;

------------------------------------------------------------
-- 11. Trigger: auto-increment report count + auto-hide
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_report()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  current_count INT;
  auto_hide_threshold INT := 3;
BEGIN
  IF NEW.target_type = 'listing' THEN
    UPDATE public.listings
      SET report_count = report_count + 1
      WHERE id = NEW.target_id
      RETURNING report_count INTO current_count;
    IF current_count >= auto_hide_threshold THEN
      UPDATE public.listings
        SET status = 'removed'
        WHERE id = NEW.target_id AND status = 'active';
    END IF;
  ELSIF NEW.target_type = 'commission_request' THEN
    UPDATE public.commission_requests
      SET report_count = report_count + 1
      WHERE id = NEW.target_id
      RETURNING report_count INTO current_count;
    IF current_count >= auto_hide_threshold THEN
      UPDATE public.commission_requests
        SET status = 'cancelled'
        WHERE id = NEW.target_id AND status = 'open';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_report_created
  AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_report();

------------------------------------------------------------
-- 12. Trigger: make reviews visible when both sides submitted
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_review_visibility()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  other_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.transaction_reviews
    WHERE commission_request_id = NEW.commission_request_id
      AND reviewer_role != NEW.reviewer_role
  ) INTO other_exists;
  IF other_exists THEN
    UPDATE public.transaction_reviews
      SET visible = TRUE
      WHERE commission_request_id = NEW.commission_request_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_transaction_review_created
  AFTER INSERT ON public.transaction_reviews
  FOR EACH ROW EXECUTE FUNCTION public.check_review_visibility();

------------------------------------------------------------
-- 13. Notification preferences for new types
------------------------------------------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS email_item_approved BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_item_rejected BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_review_received BOOLEAN NOT NULL DEFAULT TRUE;
