-- 0115: close the same class of hole 0114 fixed on `stores`, on three more
-- tables whose UPDATE policy is USING-only (no WITH CHECK) while `authenticated`
-- holds a table-wide UPDATE grant. Postgres uses the USING expression as the
-- implicit WITH CHECK, which only pins the columns the USING references — every
-- other column stays freely rewritable by a row's "owner" via direct PostgREST.
--
-- Confirmed exploitable:
--   * seller_reviews — USING (auth.uid() = reviewer_id) pins reviewer_id but NOT
--     seller_id/store_id/listing_id. A reviewer could move their review (and its
--     rating) onto ANY seller/store, manipulating arbitrary ratings with no
--     transaction between them (the stats trigger propagates it).
-- Same shape, lower severity:
--   * marketplace_conversations — a participant could rewrite buyer_id/seller_id/
--     listing_id/commission_request_id, repointing or reassigning a conversation.
--   * listing_photos — a seller could rewrite `path` (and created_at) on their own
--     photo rows. (listing_id is already constrained to own listings by the USING.)
--
-- Fix (same pattern as 0114): replace the blanket UPDATE grant with a column
-- allowlist of the genuinely user-editable fields. None of these tables has an
-- app UPDATE path (all are insert-only in the service layer), so the allowlists
-- only need to cover plausible self-edits; every identity/FK/stat/timestamp
-- column becomes ungrantable, so a direct PostgREST write is rejected.
-- service_role and SECURITY DEFINER triggers own the tables' privileges and are
-- unaffected.

begin;

-- seller_reviews: a reviewer may edit only their own rating + comment.
revoke update on public.seller_reviews from anon, authenticated;
grant update (rating, comment) on public.seller_reviews to authenticated;

-- marketplace_conversations: nothing is user-updatable (identity/FK/timestamps
-- only; updated_at is trigger/service-maintained).
revoke update on public.marketplace_conversations from anon, authenticated;

-- listing_photos: a seller may edit only the display caption + ordering.
revoke update on public.listing_photos from anon, authenticated;
grant update (caption, position) on public.listing_photos to authenticated;

commit;
