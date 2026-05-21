-- Fix infinite-recursion in store_members RLS policies.
-- The original policies used EXISTS (SELECT FROM store_members …) which
-- triggers the same RLS check recursively. Replace with a SECURITY DEFINER
-- helper that bypasses RLS for the lookup.

CREATE OR REPLACE FUNCTION public.is_store_member(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_store_min_role(p_store_id uuid, p_min_role store_member_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id
      AND user_id = auth.uid()
      AND CASE role
        WHEN 'owner' THEN 3
        WHEN 'admin' THEN 2
        WHEN 'manager' THEN 1
        WHEN 'contributor' THEN 0
      END >= CASE p_min_role
        WHEN 'owner' THEN 3
        WHEN 'admin' THEN 2
        WHEN 'manager' THEN 1
        WHEN 'contributor' THEN 0
      END
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_store_member(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_store_min_role(uuid, store_member_role) TO anon, authenticated;

-- Drop and recreate policies using the helpers
DROP POLICY IF EXISTS "stores_select_members" ON public.stores;
DROP POLICY IF EXISTS "stores_update_admin" ON public.stores;
DROP POLICY IF EXISTS "store_members_select_same_store" ON public.store_members;
DROP POLICY IF EXISTS "store_members_modify_admin" ON public.store_members;
DROP POLICY IF EXISTS "store_invitations_select_admin" ON public.store_invitations;
DROP POLICY IF EXISTS "store_invitations_insert_admin" ON public.store_invitations;

CREATE POLICY "stores_select_members"
  ON public.stores FOR SELECT
  USING (public.is_store_member(id));

CREATE POLICY "stores_update_admin"
  ON public.stores FOR UPDATE
  USING (public.has_store_min_role(id, 'manager'));

CREATE POLICY "store_members_select_same_store"
  ON public.store_members FOR SELECT
  USING (public.is_store_member(store_id));

CREATE POLICY "store_members_modify_admin"
  ON public.store_members FOR ALL
  USING (public.has_store_min_role(store_id, 'admin'));

CREATE POLICY "store_invitations_select_admin"
  ON public.store_invitations FOR SELECT
  USING (public.has_store_min_role(store_id, 'admin'));

CREATE POLICY "store_invitations_insert_admin"
  ON public.store_invitations FOR INSERT
  WITH CHECK (public.has_store_min_role(store_id, 'admin'));
