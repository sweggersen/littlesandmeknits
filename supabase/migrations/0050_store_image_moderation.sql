-- Allow 'store_image' as a moderation_queue item type for post-approval
-- logo/banner uploads that need re-review.

ALTER TABLE public.moderation_queue
  DROP CONSTRAINT IF EXISTS moderation_queue_item_type_check;

ALTER TABLE public.moderation_queue
  ADD CONSTRAINT moderation_queue_item_type_check
  CHECK (item_type IN ('listing', 'commission_request', 'store', 'store_image'));
