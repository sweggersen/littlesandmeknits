-- Following a seller is a strong personalisation signal used by the
-- promotion ranker (followedSeller weight = 0.20) and a foundation for
-- future "new from sellers you follow" feeds.

CREATE TABLE public.seller_follows (
  follower_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, seller_id),
  CHECK (follower_id <> seller_id)
);

CREATE INDEX idx_seller_follows_seller ON public.seller_follows(seller_id);

ALTER TABLE public.seller_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read follow counts"
  ON public.seller_follows FOR SELECT USING (true);

CREATE POLICY "Followers manage own follows"
  ON public.seller_follows FOR ALL
  USING (auth.uid() = follower_id)
  WITH CHECK (auth.uid() = follower_id);

-- Folded into user_preferences so the ranker reads it alongside the
-- other affinity signals. Re-create the matview to add the new column.
DROP MATERIALIZED VIEW IF EXISTS public.user_preferences;

CREATE MATERIALIZED VIEW public.user_preferences AS
WITH
  fav_categories AS (
    SELECT f.user_id, l.category::text AS category, count(*)::int AS n
    FROM public.favorites f
    JOIN public.listings l ON l.id = f.item_id
    WHERE f.item_type = 'listing'
    GROUP BY f.user_id, l.category
  ),
  clicked_items AS (
    SELECT
      i.viewer_id AS user_id,
      l.category::text AS category,
      l.size_label,
      l.size_age_months_min,
      l.size_age_months_max,
      l.price_nok,
      exp(-extract(epoch FROM (now() - coalesce(i.clicked_at, i.created_at))) / (30.0 * 86400)) AS w
    FROM public.listing_impressions i
    JOIN public.listings l ON l.id = i.listing_id
    WHERE i.clicked = true
      AND i.viewer_id IS NOT NULL
      AND coalesce(i.clicked_at, i.created_at) > now() - interval '90 days'
  ),
  clicked_categories AS (
    SELECT user_id, category, sum(w)::numeric AS w_sum, count(*)::int AS n
    FROM clicked_items GROUP BY user_id, category
  ),
  clicked_sizes AS (
    SELECT user_id, size_label, sum(w)::numeric AS w_sum, count(*)::int AS n
    FROM clicked_items WHERE size_label IS NOT NULL GROUP BY user_id, size_label
  ),
  follows AS (
    SELECT follower_id AS user_id, jsonb_agg(seller_id::text) AS sellers
    FROM public.seller_follows GROUP BY follower_id
  ),
  users AS (
    SELECT user_id FROM fav_categories
    UNION SELECT user_id FROM clicked_items
    UNION SELECT user_id FROM follows
  ),
  fav_categories_agg AS (
    SELECT user_id, jsonb_agg(jsonb_build_object('category', category, 'count', n) ORDER BY n DESC) FILTER (WHERE rn <= 5) AS top
    FROM (SELECT user_id, category, n, row_number() OVER (PARTITION BY user_id ORDER BY n DESC) AS rn FROM fav_categories) s
    GROUP BY user_id
  ),
  clicked_categories_agg AS (
    SELECT user_id, jsonb_agg(jsonb_build_object('category', category, 'weight', round(w_sum, 3), 'count', n) ORDER BY w_sum DESC) FILTER (WHERE rn <= 5) AS top
    FROM (SELECT user_id, category, w_sum, n, row_number() OVER (PARTITION BY user_id ORDER BY w_sum DESC) AS rn FROM clicked_categories) s
    GROUP BY user_id
  ),
  clicked_sizes_agg AS (
    SELECT user_id, jsonb_agg(jsonb_build_object('size_label', size_label, 'weight', round(w_sum, 3), 'count', n) ORDER BY w_sum DESC) FILTER (WHERE rn <= 5) AS top
    FROM (SELECT user_id, size_label, w_sum, n, row_number() OVER (PARTITION BY user_id ORDER BY w_sum DESC) AS rn FROM clicked_sizes) s
    GROUP BY user_id
  ),
  price_band_agg AS (
    SELECT user_id,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY price_nok)::int AS p25,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY price_nok)::int AS p50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY price_nok)::int AS p75,
      count(*)::int AS n
    FROM clicked_items WHERE price_nok IS NOT NULL
    GROUP BY user_id HAVING count(*) >= 3
  ),
  age_band_agg AS (
    SELECT user_id,
      min(size_age_months_min) AS age_min, max(size_age_months_max) AS age_max,
      count(*) FILTER (WHERE size_age_months_min IS NOT NULL)::int AS n
    FROM clicked_items GROUP BY user_id
  )
SELECT
  u.user_id,
  coalesce(fca.top, '[]'::jsonb) AS favorited_categories,
  coalesce(cca.top, '[]'::jsonb) AS clicked_categories,
  coalesce(csa.top, '[]'::jsonb) AS clicked_sizes,
  coalesce(fol.sellers, '[]'::jsonb) AS followed_sellers,
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
LEFT JOIN follows fol ON fol.user_id = u.user_id
LEFT JOIN price_band_agg pba ON pba.user_id = u.user_id
LEFT JOIN age_band_agg aba ON aba.user_id = u.user_id;

CREATE UNIQUE INDEX user_preferences_user_id_idx ON public.user_preferences(user_id);

GRANT SELECT ON public.user_preferences TO anon, authenticated, service_role;

-- refresh_user_preferences function already exists; CONCURRENTLY reuse works.
