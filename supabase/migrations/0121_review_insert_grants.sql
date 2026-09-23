-- 0121: close the review/rating INSERT bypass on the two review tables the
-- 0114–0116 sweep never touched. Same threat model as before: migration 0085
-- grants `authenticated` a blanket table role, so a direct PostgREST caller
-- (public anon key + a user JWT) skips the service layer entirely. Both review
-- services write via the service-role (`ctx.admin`) client, so the tables'
-- `authenticated` write grants exist ONLY as attack surface — no legitimate path
-- exercises them.
--
-- seller_reviews (0014): the INSERT policy checks only
--   `auth.uid() = reviewer_id AND auth.uid() <> seller_id`.
-- It does NOT require a real purchase, so a direct call can:
--   * fabricate a review (rating 1 or 5) for ANY seller with no transaction;
--   * set listing_id = NULL, which defeats the `one_review_per_listing` unique
--     constraint (NULLs are distinct in Postgres) → UNLIMITED reviews per target;
--   * set store_id to any store — the 0109 `trg_seller_reviews_store_stats`
--     trigger then recomputes that store's PUBLIC rating_avg / rating_count.
-- 0115 pinned the UPDATE path (rating, comment only); INSERT/DELETE were missed.
--
-- transaction_reviews (0037): the INSERT `WITH CHECK` never verifies the caller
-- is a PARTICIPANT of the commission, never pins reviewer_role, and never pins
-- visible=false. Using any `delivered` commission id, a direct call can publish a
-- fabricated, immediately-visible rating on any reviewee and defeat the
-- double-blind embargo (the `check_review_visibility` trigger is meant to be the
-- only thing that flips `visible`).
--
-- Fix (same pattern as 0116): revoke the `authenticated` write grants. The RLS
-- policies stay in place but have no grant to exercise, so a direct PostgREST
-- write is denied at the privilege layer. service_role and SECURITY DEFINER
-- triggers own the tables and are unaffected; the legit service inserts (via
-- ctx.admin) keep working.

begin;

-- seller_reviews: no service INSERT/DELETE runs as the user (submitSellerReview
-- inserts via ctx.admin). Keep the 0115 column-pinned UPDATE grant (rating,
-- comment) for a plausible self-edit; only INSERT/DELETE are the live hole.
revoke insert, delete on public.seller_reviews from anon, authenticated;

-- transaction_reviews: the service inserts via ctx.admin and the double-blind
-- visibility flip is a trigger, so authenticated needs NO write at all.
revoke insert, update, delete on public.transaction_reviews from anon, authenticated;

commit;
