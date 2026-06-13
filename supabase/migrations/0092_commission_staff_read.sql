-- commission_requests + commission_offers had NO staff read policy, unlike
-- listings (0037 "Admins and moderators read all listings") and orders (0088
-- orders_staff_read). The gap was masked by page modules reading these tables
-- through the service-role bypass (createAdminSupabase) to render receipts and
-- admin views. Add staff read so those pages can use the RLS-respecting client
-- and RLS is the complete authz model — no service-role bypass for plain reads.
--
-- Additive only (RLS OR's policies together): buyers/knitters keep exactly the
-- access they had (0073 commission_requests select, 0019 commission_offers).
-- Uses the SECURITY DEFINER helper (0037) so the policy never reads profiles
-- under the caller's grants (the 0077/0080 outage class).

create policy "Staff read all commission_requests"
  on public.commission_requests for select to authenticated
  using (public.is_admin_or_moderator((select auth.uid())));

create policy "Staff read all commission_offers"
  on public.commission_offers for select to authenticated
  using (public.is_admin_or_moderator((select auth.uid())));
