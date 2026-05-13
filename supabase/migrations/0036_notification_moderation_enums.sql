-- Add moderation-related notification types.
-- MUST run alone and commit before 0037.

ALTER TYPE public.notification_type ADD VALUE 'item_approved';
ALTER TYPE public.notification_type ADD VALUE 'item_rejected';
ALTER TYPE public.notification_type ADD VALUE 'item_reported';
ALTER TYPE public.notification_type ADD VALUE 'moderation_assigned';
ALTER TYPE public.notification_type ADD VALUE 'role_changed';
ALTER TYPE public.notification_type ADD VALUE 'review_received';
