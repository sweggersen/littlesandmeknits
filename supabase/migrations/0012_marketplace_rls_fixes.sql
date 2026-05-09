-- Fix RLS gaps found during marketplace testing.
-- Apply via Supabase SQL editor.

-- 1. Profiles: allow anyone to read (display_name shown on listings + messages)
create policy "Anyone can read profiles"
  on public.profiles for select using (true);

-- 2. Conversations: allow participants to update (bumps updated_at on reply)
create policy "Participants update own conversations"
  on public.marketplace_conversations for update
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- 3. Listings: prevent seller from flipping status to 'active' directly.
--    Drop the broad update policy and replace with one that blocks
--    status escalation (draft→active must go through Stripe webhook).
drop policy "Seller updates own listings" on public.listings;

create policy "Seller updates own listings"
  on public.listings for update
  using (auth.uid() = seller_id)
  with check (
    -- Allow any update that doesn't change status to 'active',
    -- OR the listing was already active (editing an active listing).
    status <> 'active' or (select status from public.listings where id = listings.id) = 'active'
  );

-- 4. Fix handle_new_user to also check for 'display_name' in metadata
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, locale)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    coalesce(new.raw_user_meta_data->>'locale', 'nb')
  );
  return new;
end;
$$;
