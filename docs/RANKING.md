# Strikketorget — Ranking & Recommendations

How listings are ordered on the marketplace home page, and how paid placements are blended with organic results.

## Today (MVP)

Two pools, then interleave.

**Pool A — Personalised / popular**
- Logged-in: items in categories the user has favorited, ordered by `favorite_count DESC, published_at DESC`.
- Logged-out: items ordered by `favorite_count DESC, published_at DESC` (popularity prior).

**Pool B — Promoted**
- All listings where `promoted_until > now()`.
- Currently no ordering between promoted items — first-come.

**Interleave** (`src/pages/market/index.astro`):
- Positions 0–3 from Pool A.
- Position 4 from Pool B.
- Positions 5–7 from Pool A.
- Promoted items get the `FREMHEVET` badge on `ListingCard`.

Rationale: paid placements get guaranteed visibility without displacing the most-relevant organic item from slot 1. This matches the price-of-relevance approach used by Etsy and eBay.

## The ranking formula (planned)

For each candidate listing `c` and viewer `u`:

```
score(c, u) = relevance(c, u) × bid_weight(c) × freshness(c) × pacing(c)
```

### relevance(c, u) — 0.1 .. 1.0

Weighted sum over user features:

| Weight | Feature | Source |
|---|---|---|
| 0.30 | Category match | Top 3 favorited + clicked categories, 30-day half-life decay |
| 0.25 | Size / age range match | Recently viewed sizes |
| 0.20 | Followed seller | `seller_follows` (table not yet built) |
| 0.15 | Price band match | Median ± stddev of clicked item prices |
| 0.10 | Condition (brukt/nytt) | Past clicks |

Clamped to [0.1, 1.0] so a poor match still gets a small chance — needed for exploration.

Cold start (no user signals): drop the relevance term, multiply by a `popularity_prior = log(1 + favorite_count) / log(1 + max_fav)` instead.

### bid_weight(c) — 0.0 .. 1.0

Promotion tier → weight:

| Tier | Weight |
|---|---|
| `boost` | 0.5 |
| `highlight` | 1.0 |

When per-listing bidding lands, this becomes `bid / max_bid_in_pool`.

### freshness(c)

```
freshness = max(1.0, 1.5 - hours_since_promoted / 24)
```

New promoted listings get up to 1.5× for the first 24 h so they can gather click data before their CTR is judged.

### pacing(c)

Equal-budget across paid sellers per day:

- Each active promotion has a `daily_budget` = `total_impressions_budget / 7`.
- Once `daily_impressions_served >= daily_budget`, score is multiplied by 0.3 (de-prioritised, not silenced).
- Counter resets at 00:00 Europe/Oslo.

This prevents the top-relevance promoted item from eating all impressions and starving the other 99 sellers.

## Diversity pass

After scoring, walk the top-N and apply a category cap: no more than 2 consecutive items of the same category in the first 8 slots. Reorders, never drops.

## Position-bias correction

Slot 1 gets ~3–5× the clicks of slot 5 regardless of quality. When we start training a CTR model from impression logs, weight each click by `1 / p(click | position)` (Joachims et al., KDD 2002). Until then, do not naively rank by raw CTR — it creates a feedback loop where whatever-is-on-top stays on top.

## Data we need to log

Already logging in `listing_impressions`:
- `viewer_id`, `listing_id`, `position`, `promoted`, `clicked`.

Still to add:
- `user_preferences` materialized view: top-3 favorited categories, top-3 clicked categories (decayed), typical price band, preferred size buckets. Refresh hourly.
- `daily_impressions_served` column on `listing_promotions`.
- `seller_follows` table (future).
- Search query log → category/size mapping.

## Surfacing this to sellers

In the promotion stats page show:
- Total impressions and clicks (organic + promoted, split).
- "Vist mest til: 0–3 mnd kjøpere, prisspenn 200–400 kr."

Transparency on *who* the listing reached makes paying for promotion feel like a measured investment, not a black box.

## Roadmap

| Stage | Inventory / volume | Approach |
|---|---|---|
| Now | <1k listings, no click data | Pool-based interleave, popularity prior |
| Q3 2026 | 1–10k listings | Add `user_preferences` view, weighted-feature scorer, equal-budget pacing |
| Q4 2026 | 10k+ listings, ~10k transactions | Item-to-item collaborative filtering from co-buy matrix, position-debiased CTR |
| 2027 | 100k+ | Two-stage retrieval → ranking, GBM/LambdaMART on logged features, Thompson-sampled ad auction |

## References

- Covington et al., *Deep Neural Networks for YouTube Recommendations*, RecSys 2016 — two-stage retrieval/ranking.
- Joachims et al., *Learning to Rank from Implicit Feedback*, KDD 2002 — position-bias correction.
- Carbonell & Goldstein, *Maximal Marginal Relevance*, SIGIR 1998 — diversification.
- Etsy engineering blog — Promoted Listings auction reuses organic relevance as the floor.
- Schibsted tech blog (Finn.no) — transformer recall + GBM ranker.
