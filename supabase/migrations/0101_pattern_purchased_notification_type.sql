-- Notification type for a completed pattern-PDF purchase, so the buyer gets an
-- in-app "your pattern is ready" with a link to download it (listings already
-- fire listing_purchased; patterns previously relied on the Stripe receipt +
-- /profile/purchases only). Fired from the checkout.session.completed webhook.
alter type public.notification_type add value if not exists 'pattern_purchased';
