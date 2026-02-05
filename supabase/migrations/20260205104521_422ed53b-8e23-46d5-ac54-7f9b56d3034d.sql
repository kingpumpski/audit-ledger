-- Ensure a sequence row exists for product SKUs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sequences WHERE name = 'product') THEN
    INSERT INTO public.sequences (name, prefix, padding, current_value, updated_at)
    VALUES ('product', 'PRD-', 5, 0, now());
  END IF;
END $$;

-- Auto-generate SKU if missing/blank on insert
CREATE OR REPLACE FUNCTION public.products_set_sku_if_missing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  next_sku text;
BEGIN
  IF NEW.sku IS NULL OR btrim(NEW.sku) = '' THEN
    next_sku := public.get_next_sequence('product');
    IF next_sku IS NULL OR btrim(next_sku) = '' THEN
      RAISE EXCEPTION 'Failed to generate SKU (sequence returned null/empty)';
    END IF;
    NEW.sku := next_sku;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_set_sku_if_missing ON public.products;
CREATE TRIGGER trg_products_set_sku_if_missing
BEFORE INSERT ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.products_set_sku_if_missing();
