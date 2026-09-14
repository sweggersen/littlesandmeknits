-- Notification type for a new listing from a store the user FOLLOWS (Butikker
-- Phase 2). Mirrors seller_new_listing but keyed on the store, so a follower
-- gets "Fjellgarn la ut en ny annonse" when a followed store publishes. Fired
-- from the same publish points as the seller fan-out (trusted publish +
-- moderation approval). Standalone (its own file) so ADD VALUE isn't used in
-- the same transaction it's created — matches 0100/0101.
alter type public.notification_type add value if not exists 'store_new_listing';
