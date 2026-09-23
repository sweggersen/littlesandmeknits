-- 0120: indexes for hot authed queries the review found seq-scanning.
--
-- Each column below is an FK / filter used on a per-user page load with no
-- covering index. All additive (CREATE INDEX IF NOT EXISTS), no behaviour change.

-- orders: "my purchases" (buyer_id) and "my sales" (seller_id + status).
create index if not exists orders_buyer_idx on public.orders (buyer_id);
create index if not exists orders_seller_status_idx on public.orders (seller_id, status);

-- store_favorites: the hot direction is "my favourited stores" (user_id);
-- only store_id was indexed.
create index if not exists store_favorites_user_idx on public.store_favorites (user_id);

-- follow tables: "who do I follow" (follower_id); only the *_id side was indexed.
create index if not exists store_follows_follower_idx on public.store_follows (follower_id);
create index if not exists seller_follows_follower_idx on public.seller_follows (follower_id);

-- notifications inbox: user_id + newest-first over read AND unread (the partial
-- unread-only index can't serve the full list sort).
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
