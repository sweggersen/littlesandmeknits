-- Atomic RPCs for moderation stats.
-- Replaces read-then-write patterns in review/shadow-confirm API routes.

-- 1. Upsert moderator review stats (atomic)
CREATE OR REPLACE FUNCTION public.upsert_moderator_review(
  p_user_id  uuid,
  p_decision text,
  p_rate     numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.moderator_stats (
    user_id, total_reviews, total_approvals, total_rejections,
    current_month_reviews, current_month_earned_nok, total_earned_nok,
    rate_nok_per_review, last_review_at
  ) VALUES (
    p_user_id, 1,
    CASE WHEN p_decision = 'approve' THEN 1 ELSE 0 END,
    CASE WHEN p_decision = 'reject'  THEN 1 ELSE 0 END,
    1, p_rate, p_rate, p_rate, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_reviews          = moderator_stats.total_reviews + 1,
    total_approvals        = moderator_stats.total_approvals
                             + CASE WHEN p_decision = 'approve' THEN 1 ELSE 0 END,
    total_rejections       = moderator_stats.total_rejections
                             + CASE WHEN p_decision = 'reject'  THEN 1 ELSE 0 END,
    current_month_reviews  = moderator_stats.current_month_reviews + 1,
    current_month_earned_nok = moderator_stats.current_month_earned_nok + p_rate,
    total_earned_nok       = moderator_stats.total_earned_nok + p_rate,
    rate_nok_per_review    = p_rate,
    last_review_at         = now();
END;
$$;

-- 2. Atomic shadow-override increment
CREATE OR REPLACE FUNCTION public.increment_shadow_overrides(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.moderator_stats
  SET shadow_overrides = shadow_overrides + 1
  WHERE user_id = p_user_id;
END;
$$;

-- 3. Atomic profile rejection increment
CREATE OR REPLACE FUNCTION public.increment_profile_rejections(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET total_rejections = total_rejections + 1
  WHERE id = p_user_id;
END;
$$;
