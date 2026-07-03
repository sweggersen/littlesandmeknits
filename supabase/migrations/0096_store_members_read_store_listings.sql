-- Store members can read every listing that belongs to their store, whatever
-- its status. Without this, the store admin inventory page
-- (src/pages/market/store/[slug]/admin/listings.astro), which reads listings
-- via the RLS-scoped client, hid co-members' draft / pending_review / rejected
-- / reserved / shipped listings in MULTI-MEMBER stores: a manager who wasn't
-- the seller of a given row could only see 'active' (public) listings plus
-- their own. Single-owner stores were unaffected (owner == seller of every
-- store listing), which is why this slipped through.
--
-- is_store_member() is SECURITY DEFINER (0047), so evaluating it inside a
-- listings policy does not recurse into store_members RLS.
create policy "Store members read store listings"
  on public.listings for select
  using (store_id is not null and public.is_store_member(store_id));
