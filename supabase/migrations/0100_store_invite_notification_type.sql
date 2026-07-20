-- Notification type for store invitations, so an invited user with an account
-- gets an in-app notification (their inbox) instead of only discovering the
-- invite by chance. Pending invites are also surfaced on /profile/stores.
alter type public.notification_type add value if not exists 'store_invite';
