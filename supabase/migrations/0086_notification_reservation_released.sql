-- H2 (escrow auth-expiry): a reserved listing whose ship-by deadline passes, or
-- whose Stripe manual-capture auth is canceled, is released back to 'active' and
-- both parties are notified (buyer: not charged; seller: relisted). New
-- notification_type for those notices.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'listing_reservation_released';
