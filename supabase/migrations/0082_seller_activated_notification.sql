-- june26.md §1.6 — notify a seller when their Stripe Connect verification
-- completes ("you can get paid now"). In-app + email via the notification system.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'seller_activated';
