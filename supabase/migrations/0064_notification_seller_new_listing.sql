-- Extend notification_type enum so notifyFollowersOfNewListing can insert.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'seller_new_listing';
