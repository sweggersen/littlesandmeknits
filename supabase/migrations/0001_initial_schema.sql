-- Littles and Me — initial schema (auth + commerce)
-- Apply via Supabase SQL editor or `supabase db push`

------------------------------------------------------------
-- profiles: extends auth.users
------------------------------------------------------------
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text,
  instagram_handle text,
  locale text not null default 'nb' check (locale in ('nb', 'en')),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update using (auth.uid() = id);

-- Auto-create a profile row when a new auth user is created
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, locale)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'locale', 'nb')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

------------------------------------------------------------
-- purchases
------------------------------------------------------------
create type public.purchase_status as enum ('pending', 'completed', 'refunded');

create table public.purchases (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  pattern_slug text not null,
  stripe_session_id text unique not null,
  amount_nok integer not null,
  currency text not null default 'NOK',
  status public.purchase_status not null default 'pending',
  pdf_path text,
  created_at timestamp with time zone default now() not null,
  fulfilled_at timestamp with time zone
);

create index purchases_user_id_idx on public.purchases (user_id);
create index purchases_pattern_slug_idx on public.purchases (pattern_slug);

alter table public.purchases enable row level security;

create policy "Users can read their own purchases"
  on public.purchases for select using (auth.uid() = user_id);

-- Inserts/updates/deletes intentionally have NO policies. They run from the
-- Stripe webhook handler using the service-role key, which bypasses RLS.

------------------------------------------------------------
-- Storage: patterns bucket
------------------------------------------------------------
-- Create the bucket via the Supabase dashboard (or `supabase storage create patterns`).
-- Make it PRIVATE. PDF delivery uses signed URLs generated server-side after
-- verifying ownership via the purchases table — no storage RLS policies needed.

-- Suggested folder layout inside the bucket:
--   patterns/<slug>/v1.pdf
--   patterns/<slug>/v2.pdf  (when you publish updates)
-- The pdf_path column on purchases stores the full key (e.g. "<slug>/v1.pdf").
