-- user_preferences: per-viewer signal aggregate used by the promoted-pool
-- ranker. Combines strong intent (favorites) with weak intent (recent
-- clicks), plus inferred price band and preferred sizes/ages.
--
-- This is a materialized view because we read it on every marketplace
-- home render but only need it to be fresh-ish (hourly is fine). Refresh
-- via SELECT public.refresh_user_preferences() from a cron job.

CREATE MATERIALIZED VIEW public.user_preferences AS
WITH
  -- Strong-intent signal: favorited listings (no decay; favorites are sticky).
  fav_categories AS (
    SELECT f.user_id, l.category::text AS category, count(*)::int AS n
    FROM public.favorites f
    JOIN public.listings l ON l.id = f.item_id
    WHERE f.item_type = 'listing'
    GROUP BY f.user_id, l.category
  ),
  -- Weak-intent signal: clicked impressions in the last 30 days,
  -- exponentially decayed (~30-day half-life).
  clicked_items AS (
    SELECT
      i.viewer_id AS user_id,
      l.category::text AS category,
      l.size_label,
      l.size_age_months_min,
      l.size_age_months_max,
      l.price_nok,
      -- weight ~ exp(-days_ago / 30); fresher clicks count more
      exp(-extract(epoch FROM (now() - coalesce(i.clicked_at, i.created_at))) / (30.0 * 86400)) AS w
    FROM public.listing_impressions i
    JOIN public.listings l ON l.id = i.listing_id
    WHERE i.clicked = true
      AND i.viewer_id IS NOT NULL
      AND coalesce(i.clicked_at, i.created_at) > now() - interval '90 days'
  ),
  clicked_categories AS (
    SELECT user_id, category, sum(w)::numeric AS w_sum, count(*)::int AS n
    FROM clicked_items
    GROUP BY user_id, category
  ),
  clicked_sizes AS (
    SELECT user_id, size_label, sum(w)::numeric AS w_sum, count(*)::int AS n
    FROM clicked_items
    WHERE size_label IS NOT NULL
    GROUP BY user_id, size_label
  ),
  -- All distinct user_ids we have any signal for.
  users AS (
    SELECT user_id FROM fav_categories
    UNION
    SELECT user_id FROM clicked_items
  ),
  fav_categories_agg AS (
    SELECT user_id, jsonb_agg(
      jsonb_build_object('category', category, 'count', n)
      ORDER BY n DESC
    ) FILTER (WHERE rn <= 5) AS top
    FROM (
      SELECT user_id, category, n,
        row_number() OVER (PARTITION BY user_id ORDER BY n DESC) AS rn
      FROM fav_categories
    ) s
    GROUP BY user_id
  ),
  clicked_categories_agg AS (
    SELECT user_id, jsonb_agg(
      jsonb_build_object('category', category, 'weight', round(w_sum, 3), 'count', n)
      ORDER BY w_sum DESC
    ) FILTER (WHERE rn <= 5) AS top
    FROM (
      SELECT user_id, category, w_sum, n,
        row_number() OVER (PARTITION BY user_id ORDER BY w_sum DESC) AS rn
      FROM clicked_categories
    ) s
    GROUP BY user_id
  ),
  clicked_sizes_agg AS (
    SELECT user_id, jsonb_agg(
      jsonb_build_object('size_label', size_label, 'weight', round(w_sum, 3), 'count', n)
      ORDER BY w_sum DESC
    ) FILTER (WHERE rn <= 5) AS top
    FROM (
      SELECT user_id, size_label, w_sum, n,
        row_number() OVER (PARTITION BY user_id ORDER BY w_sum DESC) AS rn
      FROM clicked_sizes
    ) s
    GROUP BY user_id
  ),
  price_band_agg AS (
    SELECT
      user_id,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY price_nok)::int AS p25,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY price_nok)::int AS p50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY price_nok)::int AS p75,
      count(*)::int AS n
    FROM clicked_items
    WHERE price_nok IS NOT NULL
    GROUP BY user_id
    HAVING count(*) >= 3
  ),
  age_band_agg AS (
    SELECT
      user_id,
      min(size_age_months_min) AS age_min,
      max(size_age_months_max) AS age_max,
      count(*) FILTER (WHERE size_age_months_min IS NOT NULL)::int AS n
    FROM clicked_items
    GROUP BY user_id
  )
SELECT
  u.user_id,
  coalesce(fca.top, '[]'::jsonb) AS favorited_categories,
  coalesce(cca.top, '[]'::jsonb) AS clicked_categories,
  coalesce(csa.top, '[]'::jsonb) AS clicked_sizes,
  CASE WHEN pba.n IS NOT NULL THEN
    jsonb_build_object('p25', pba.p25, 'p50', pba.p50, 'p75', pba.p75, 'n', pba.n)
  END AS price_band,
  CASE WHEN aba.n > 0 THEN
    jsonb_build_object('min', aba.age_min, 'max', aba.age_max, 'n', aba.n)
  END AS age_band,
  now() AS refreshed_at
FROM users u
LEFT JOIN fav_categories_agg fca ON fca.user_id = u.user_id
LEFT JOIN clicked_categories_agg cca ON cca.user_id = u.user_id
LEFT JOIN clicked_sizes_agg csa ON csa.user_id = u.user_id
LEFT JOIN price_band_agg pba ON pba.user_id = u.user_id
LEFT JOIN age_band_agg aba ON aba.user_id = u.user_id;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX user_preferences_user_id_idx
  ON public.user_preferences(user_id);

-- Service role refreshes (RLS doesn't apply to matviews, but we still
-- want a single entry point with predictable permissions).
CREATE OR REPLACE FUNCTION public.refresh_user_preferences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.user_preferences;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_user_preferences() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_user_preferences() TO service_role;

-- Allow the API server (anon, authenticated) to read the matview through
-- the supabase client. There is no RLS on matviews, so this is a grant.
GRANT SELECT ON public.user_preferences TO anon, authenticated, service_role;
