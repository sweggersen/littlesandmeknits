-- Explicit GRANTs for all public tables.
-- Supabase is deprecating implicit Data API access (Oct 30 2026).
-- This migration ensures all tables remain accessible via supabase-js.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_logs TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_yarns TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yarns TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.needles TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_patterns TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listings TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_photos TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_promotions TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_impressions TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_requests TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_offers TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_conversations TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_messages TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_reviews TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_reviews TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorites TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.moderation_queue TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.moderation_audit_log TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.moderator_stats TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.moderator_payouts TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_achievements TO anon, authenticated, service_role;
