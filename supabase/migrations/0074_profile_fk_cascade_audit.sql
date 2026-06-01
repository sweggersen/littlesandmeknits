-- R2-7: every FK to profiles(id) gets an explicit ON DELETE clause.
--
-- Audit found 7 FKs without one, defaulting to NO ACTION. That makes
-- deleteAccount() fail loudly on the first row that references the
-- user — silently leaving the profile half-deleted. Each clause below
-- is chosen by semantics:
--
--   cascade  → owned by the user; gone when they're gone
--   set null → records of past activity that outlive the user;
--              the column tracks "who did this" but the row itself
--              is historical and must survive
--
-- All changes are pure FK-clause swaps; no row content moves.

begin;

-- listing_promotions.seller_id: promotion data is owned by the seller.
-- When they leave, the promotion row goes too.
alter table public.listing_promotions
  drop constraint if exists listing_promotions_seller_id_fkey,
  add constraint listing_promotions_seller_id_fkey
    foreign key (seller_id) references public.profiles(id) on delete cascade;

-- listings.buyer_id: a sold listing is the seller's historical record.
-- Buyer can delete their account without erasing the seller's books.
alter table public.listings
  drop constraint if exists listings_buyer_id_fkey,
  add constraint listings_buyer_id_fkey
    foreign key (buyer_id) references public.profiles(id) on delete set null;

-- stores.created_by + reviewed_by: stores outlive their founder
-- (membership transfers happen) and moderation history outlives the
-- moderator who reviewed it.
alter table public.stores
  drop constraint if exists stores_created_by_fkey,
  add constraint stores_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.stores
  drop constraint if exists stores_reviewed_by_fkey,
  add constraint stores_reviewed_by_fkey
    foreign key (reviewed_by) references public.profiles(id) on delete set null;

-- store_members.invited_by: invitation history is the store's record,
-- not the inviter's. (user_id already cascades — that's correct for
-- "membership belongs to the user.")
alter table public.store_members
  drop constraint if exists store_members_invited_by_fkey,
  add constraint store_members_invited_by_fkey
    foreign key (invited_by) references public.profiles(id) on delete set null;

-- store_invitations.invited_by + accepted_by: historical record.
alter table public.store_invitations
  drop constraint if exists store_invitations_invited_by_fkey,
  add constraint store_invitations_invited_by_fkey
    foreign key (invited_by) references public.profiles(id) on delete set null;
alter table public.store_invitations
  drop constraint if exists store_invitations_accepted_by_fkey,
  add constraint store_invitations_accepted_by_fkey
    foreign key (accepted_by) references public.profiles(id) on delete set null;

commit;
