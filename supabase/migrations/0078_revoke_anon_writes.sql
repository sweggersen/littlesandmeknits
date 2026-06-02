-- Security audit F3: anon holds full INSERT/UPDATE/DELETE on ~28 tables (0044).
--
-- Logged-out users never legitimately write these — every write path goes
-- through an authenticated service (ctx.supabase, auth.uid() set) or the
-- service-role key (ctx.admin, bypasses RLS). The existing RLS policies already
-- deny anon writes (they key on auth.uid(), which is null for anon), so this
-- REVOKE is defense-in-depth: it removes RLS as the *sole* gate, so a future
-- loose/missing policy can't silently become an anonymous write primitive.
--
-- listing_impressions is deliberately NOT included: anonymous view tracking is
-- a legitimate logged-out write. Flood/forgery risk there is mitigated with
-- rate-limiting at the app layer, not by removing the grant.

REVOKE INSERT, UPDATE, DELETE ON
  public.profiles,
  public.projects,
  public.project_logs,
  public.project_yarns,
  public.yarns,
  public.needles,
  public.external_patterns,
  public.notifications,
  public.notification_preferences,
  public.push_subscriptions,
  public.listings,
  public.listing_photos,
  public.listing_promotions,
  public.commission_requests,
  public.commission_offers,
  public.marketplace_conversations,
  public.marketplace_messages,
  public.purchases,
  public.seller_reviews,
  public.transaction_reviews,
  public.favorites,
  public.reports,
  public.moderation_queue,
  public.moderation_audit_log,
  public.moderator_stats,
  public.moderator_payouts,
  public.user_achievements
FROM anon;
