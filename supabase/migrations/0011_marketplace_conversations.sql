-- In-app messaging between buyer and seller about a listing.
-- One conversation per (listing, buyer) pair. Both participants can
-- post messages. Seller sees all conversations for their listings;
-- buyer sees conversations they started.

create table public.marketplace_conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, buyer_id)
);

create index conversations_seller_idx
  on public.marketplace_conversations(seller_id, updated_at desc);
create index conversations_buyer_idx
  on public.marketplace_conversations(buyer_id, updated_at desc);

create trigger conversations_set_updated_at
  before update on public.marketplace_conversations
  for each row execute function public.set_updated_at();

alter table public.marketplace_conversations enable row level security;

create policy "Participants read own conversations"
  on public.marketplace_conversations for select
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

create policy "Buyer starts conversation"
  on public.marketplace_conversations for insert
  with check (auth.uid() = buyer_id);

create table public.marketplace_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.marketplace_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index messages_conversation_idx
  on public.marketplace_messages(conversation_id, created_at);

alter table public.marketplace_messages enable row level security;

create policy "Participants read messages"
  on public.marketplace_messages for select
  using (
    exists (
      select 1 from public.marketplace_conversations c
      where c.id = conversation_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );

create policy "Participants send messages"
  on public.marketplace_messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.marketplace_conversations c
      where c.id = conversation_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );
