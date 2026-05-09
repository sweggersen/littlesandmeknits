-- Allow conversations for commissions (not just listings).
-- Makes listing_id nullable and adds commission_request_id.

alter table public.marketplace_conversations
  alter column listing_id drop not null;

alter table public.marketplace_conversations
  add column if not exists commission_request_id uuid references public.commission_requests(id) on delete cascade;

-- Replace the single unique constraint with partial indexes for each context
alter table public.marketplace_conversations
  drop constraint if exists marketplace_conversations_listing_id_buyer_id_key;

create unique index if not exists uniq_conv_listing
  on public.marketplace_conversations(listing_id, buyer_id)
  where listing_id is not null;

create unique index if not exists uniq_conv_commission
  on public.marketplace_conversations(commission_request_id, buyer_id)
  where commission_request_id is not null;

-- Allow commission participants (buyer or accepted knitter) to start conversations
drop policy if exists "Buyer starts conversation" on public.marketplace_conversations;

create policy "Participant starts conversation"
  on public.marketplace_conversations for insert
  with check (
    auth.uid() = buyer_id
    or auth.uid() = seller_id
  );
