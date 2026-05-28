-- Pacing for the promoted-pool ranker.
--
-- daily_budget: max impressions per day for this promotion. Tier-based
--   defaults: boost 50/day, highlight 150/day (≈ 350/1050 over a 7-day run).
-- daily_impressions_served: counter, reset by /api/cron/run once per 24h.
-- daily_window_start: when the current counter window opened.
-- promoted_at on listings: when the active promotion started, so the
--   ranker's freshness term doesn't have to infer from promoted_until - 7d.

ALTER TABLE public.listing_promotions
  ADD COLUMN IF NOT EXISTS daily_budget int NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS daily_impressions_served int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_window_start timestamptz NOT NULL DEFAULT now();

-- Tier defaults already baked into rows we insert via simulatePromotion /
-- promoteListing. Backfill existing rows.
UPDATE public.listing_promotions SET daily_budget = 50  WHERE tier = 'boost'     AND daily_budget = 100;
UPDATE public.listing_promotions SET daily_budget = 150 WHERE tier = 'highlight' AND daily_budget = 100;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

-- Backfill promoted_at for already-active promotions.
UPDATE public.listings l
SET promoted_at = lp.starts_at
FROM public.listing_promotions lp
WHERE lp.listing_id = l.id
  AND lp.status = 'active'
  AND l.promoted_at IS NULL;

-- Auto-increment trigger: each promoted impression bumps the active
-- promotion's daily counter. Runs as SECURITY DEFINER so it works
-- regardless of who inserted the impression row (anon, auth, service).
CREATE OR REPLACE FUNCTION public.bump_promotion_impression_counter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.promoted IS TRUE THEN
    UPDATE public.listing_promotions
    SET daily_impressions_served = daily_impressions_served + 1
    WHERE listing_id = NEW.listing_id
      AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_promotion_counter ON public.listing_impressions;
CREATE TRIGGER trg_bump_promotion_counter
  AFTER INSERT ON public.listing_impressions
  FOR EACH ROW EXECUTE FUNCTION public.bump_promotion_impression_counter();

-- Daily window reset, called from /api/cron/run. Resets the counter for
-- any promotion whose window opened more than 24h ago.
CREATE OR REPLACE FUNCTION public.reset_promotion_daily_windows()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  UPDATE public.listing_promotions
  SET daily_impressions_served = 0, daily_window_start = now()
  WHERE status = 'active'
    AND daily_window_start < now() - interval '24 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_promotion_daily_windows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_promotion_daily_windows() TO service_role;

-- Seller transparency: aggregate the audience for a listing's impressions.
-- "Of the people who saw your listing, here's what categories/sizes they
-- favorite." Reads via service role so it can see other users' favorites.
CREATE OR REPLACE FUNCTION public.promotion_audience_breakdown(p_listing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  top_categories jsonb;
  top_sizes jsonb;
  total_viewers int;
BEGIN
  WITH viewers AS (
    SELECT DISTINCT viewer_id
    FROM listing_impressions
    WHERE listing_id = p_listing_id AND viewer_id IS NOT NULL
  ),
  fav_cats AS (
    SELECT l.category::text AS category, count(*)::int AS n
    FROM viewers v
    JOIN favorites f ON f.user_id = v.viewer_id AND f.item_type = 'listing'
    JOIN listings l ON l.id = f.item_id
    GROUP BY l.category
    ORDER BY n DESC LIMIT 5
  ),
  fav_sizes AS (
    SELECT l.size_label AS size_label, count(*)::int AS n
    FROM viewers v
    JOIN favorites f ON f.user_id = v.viewer_id AND f.item_type = 'listing'
    JOIN listings l ON l.id = f.item_id
    WHERE l.size_label IS NOT NULL
    GROUP BY l.size_label
    ORDER BY n DESC LIMIT 5
  )
  SELECT
    coalesce((SELECT jsonb_agg(jsonb_build_object('category', category, 'count', n)) FROM fav_cats), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object('size_label', size_label, 'count', n)) FROM fav_sizes), '[]'::jsonb),
    (SELECT count(*) FROM viewers)
  INTO top_categories, top_sizes, total_viewers;

  RETURN jsonb_build_object(
    'top_categories', top_categories,
    'top_sizes', top_sizes,
    'viewer_count', total_viewers
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promotion_audience_breakdown(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promotion_audience_breakdown(uuid) TO authenticated, service_role;
