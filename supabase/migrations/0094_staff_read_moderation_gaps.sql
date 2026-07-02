-- Staff-read RLS for the three tables the /admin/* pages still needed the
-- service-role bypass for. With these, every admin-page READ is expressible
-- under RLS and the pages move to the cookie-bound client (the bypass remains
-- only inside services, for auth.admin API calls that genuinely require it).
--
-- Additive only (RLS OR's policies): existing seller/participant access is
-- unchanged. Uses the SECURITY DEFINER helper (0037) so no policy reads
-- profiles columns under the caller's grants (the 0077/0080 outage class).

-- Moderation reviews pending/suspended stores; staff could previously only
-- see active ones (0046 public policy) or their own memberships.
create policy "Staff read any store"
  on public.stores for select to authenticated
  using (public.is_admin_or_moderator((select auth.uid())));

-- Moderation reviews photos of pending_review listings; the 0010-era policy
-- only exposes photos of active listings (or the seller's own).
create policy "Staff read any listing photos"
  on public.listing_photos for select to authenticated
  using (public.is_admin_or_moderator((select auth.uid())));

-- Dispute resolution shows the buyer/seller conversation for context;
-- previously participants-only.
create policy "Staff read any marketplace conversation"
  on public.marketplace_conversations for select to authenticated
  using (public.is_admin_or_moderator((select auth.uid())));
