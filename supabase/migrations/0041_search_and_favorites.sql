-- Full-text search on listings (auto-maintained generated column)
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_listings_search ON public.listings USING gin(search_vector);

-- Full-text search on commission_requests
ALTER TABLE public.commission_requests
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_commission_requests_search ON public.commission_requests USING gin(search_vector);

-- Favorites table
CREATE TABLE IF NOT EXISTS public.favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('listing', 'commission_request')),
  item_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT favorites_unique UNIQUE (user_id, item_type, item_id)
);

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own favorites"
  ON public.favorites FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON public.favorites(user_id, item_type);
CREATE INDEX IF NOT EXISTS idx_favorites_item ON public.favorites(item_type, item_id);

-- Denormalized favorite counts
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS favorite_count int NOT NULL DEFAULT 0;
ALTER TABLE public.commission_requests
  ADD COLUMN IF NOT EXISTS favorite_count int NOT NULL DEFAULT 0;

-- Trigger to maintain counts
CREATE OR REPLACE FUNCTION public.update_favorite_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.item_type = 'listing' THEN
      UPDATE public.listings SET favorite_count = favorite_count + 1 WHERE id = NEW.item_id;
    ELSE
      UPDATE public.commission_requests SET favorite_count = favorite_count + 1 WHERE id = NEW.item_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.item_type = 'listing' THEN
      UPDATE public.listings SET favorite_count = greatest(0, favorite_count - 1) WHERE id = OLD.item_id;
    ELSE
      UPDATE public.commission_requests SET favorite_count = greatest(0, favorite_count - 1) WHERE id = OLD.item_id;
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE TRIGGER on_favorite_change
  AFTER INSERT OR DELETE ON public.favorites
  FOR EACH ROW EXECUTE FUNCTION public.update_favorite_count();
