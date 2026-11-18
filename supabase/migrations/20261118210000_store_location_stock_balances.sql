-- Location-aware stock projection foundation.
-- Existing inventory_transactions remains the canonical movement record; this
-- migration adds location attribution and a protected on-hand projection.
BEGIN;

CREATE TABLE public.store_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  location_type text NOT NULL DEFAULT 'store'
    CHECK (location_type IN ('store', 'warehouse', 'van', 'virtual')),
  timezone text NOT NULL DEFAULT 'Africa/Accra',
  address text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_locations_code_nonblank CHECK (length(btrim(code)) > 0),
  CONSTRAINT store_locations_name_nonblank CHECK (length(btrim(name)) > 0),
  CONSTRAINT store_locations_business_code_key UNIQUE (business_id, code),
  CONSTRAINT store_locations_business_id_key UNIQUE (business_id, id)
);

CREATE UNIQUE INDEX uq_store_locations_one_default_per_business
  ON public.store_locations (business_id)
  WHERE is_default;

-- Every existing business receives one default location. Existing stock is
-- snapshotted once into the projection; historical movements are not replayed.
INSERT INTO public.store_locations (
  business_id, code, name, location_type, timezone, is_default
)
SELECT
  b.id,
  'MAIN',
  COALESCE(NULLIF(btrim(b.name), ''), 'Main Store'),
  'store',
  COALESCE(NULLIF(btrim(b.timezone), ''), 'Africa/Accra'),
  true
FROM public.businesses b
ON CONFLICT (business_id, code) DO NOTHING;

DO $negative_stock_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.products p
    WHERE NOT COALESCE(p.is_service, false)
      AND COALESCE(p.stock_quantity, 0) < 0
  ) THEN
    RAISE EXCEPTION
      'Store-location rollout blocked: negative legacy product stock must be reconciled before creating location balances';
  END IF;
END;
$negative_stock_preflight$;

CREATE TABLE public.stock_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL,
  product_id uuid NOT NULL,
  on_hand numeric(15,3) NOT NULL DEFAULT 0,
  reserved numeric(15,3) NOT NULL DEFAULT 0,
  quarantined numeric(15,3) NOT NULL DEFAULT 0,
  available_quantity numeric(15,3)
    GENERATED ALWAYS AS (on_hand - reserved - quarantined) STORED,
  opening_quantity numeric(15,3) NOT NULL DEFAULT 0,
  opening_snapshot_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_balances_nonnegative CHECK (
    on_hand >= 0 AND reserved >= 0 AND quarantined >= 0
    AND reserved + quarantined <= on_hand
  ),
  CONSTRAINT stock_balances_business_location_product_key
    UNIQUE (business_id, location_id, product_id),
  CONSTRAINT stock_balances_location_fk
    FOREIGN KEY (business_id, location_id)
    REFERENCES public.store_locations (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_balances_product_fk
    FOREIGN KEY (business_id, product_id)
    REFERENCES public.products (business_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_stock_balances_business_product
  ON public.stock_balances (business_id, product_id);
CREATE INDEX idx_stock_balances_location_available
  ON public.stock_balances (business_id, location_id, available_quantity);

CREATE TABLE public.product_location_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL,
  product_id uuid NOT NULL,
  minimum_quantity numeric(15,3) NOT NULL DEFAULT 0,
  reorder_point numeric(15,3) NOT NULL DEFAULT 0,
  safety_stock numeric(15,3) NOT NULL DEFAULT 0,
  target_quantity numeric(15,3),
  lead_time_days integer NOT NULL DEFAULT 0,
  replenishment_method text NOT NULL DEFAULT 'min_max'
    CHECK (replenishment_method IN ('manual', 'min_max', 'reorder_point')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_location_settings_nonnegative CHECK (
    minimum_quantity >= 0 AND reorder_point >= 0 AND safety_stock >= 0
    AND (target_quantity IS NULL OR target_quantity >= 0)
    AND lead_time_days >= 0
  ),
  CONSTRAINT product_location_settings_business_location_product_key
    UNIQUE (business_id, location_id, product_id),
  CONSTRAINT product_location_settings_location_fk
    FOREIGN KEY (business_id, location_id)
    REFERENCES public.store_locations (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT product_location_settings_product_fk
    FOREIGN KEY (business_id, product_id)
    REFERENCES public.products (business_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_product_location_settings_replenishment
  ON public.product_location_settings (business_id, location_id, is_active, replenishment_method);

-- New movement rows must identify a location. The trigger resolves omitted
-- locations to the business default to keep existing stock RPCs compatible.
ALTER TABLE public.inventory_transactions
  ADD COLUMN location_id uuid,
  ADD COLUMN destination_location_id uuid;

UPDATE public.inventory_transactions it
SET location_id = sl.id
FROM public.store_locations sl
WHERE sl.business_id = it.business_id
  AND sl.is_default
  AND it.location_id IS NULL;

ALTER TABLE public.inventory_transactions
  ALTER COLUMN location_id SET NOT NULL,
  ADD CONSTRAINT inventory_transactions_location_fk
    FOREIGN KEY (business_id, location_id)
    REFERENCES public.store_locations (business_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT inventory_transactions_destination_location_fk
    FOREIGN KEY (business_id, destination_location_id)
    REFERENCES public.store_locations (business_id, id) ON DELETE RESTRICT;

CREATE INDEX idx_inventory_transactions_business_location_created
  ON public.inventory_transactions (business_id, location_id, created_at DESC);

-- Baseline the new projection from the current aggregate stock. This is a
-- snapshot, not a replay of the legacy movement history.
INSERT INTO public.stock_balances (
  business_id, location_id, product_id, on_hand, opening_quantity, opening_snapshot_at
)
SELECT
  p.business_id,
  sl.id,
  p.id,
  COALESCE(p.stock_quantity, 0)::numeric(15,3),
  COALESCE(p.stock_quantity, 0)::numeric(15,3),
  now()
FROM public.products p
JOIN public.store_locations sl
  ON sl.business_id = p.business_id AND sl.is_default
WHERE NOT COALESCE(p.is_service, false)
ON CONFLICT (business_id, location_id, product_id) DO NOTHING;

INSERT INTO public.product_location_settings (
  business_id, location_id, product_id, minimum_quantity, reorder_point,
  target_quantity, replenishment_method
)
SELECT
  p.business_id,
  sl.id,
  p.id,
  GREATEST(COALESCE(p.min_stock_level, 0), 0)::numeric(15,3),
  GREATEST(COALESCE(p.min_stock_level, 0), 0)::numeric(15,3),
  CASE
    WHEN COALESCE(p.min_stock_level, 0) > 0
      THEN GREATEST(COALESCE(p.min_stock_level, 0), 0) * 2
    ELSE NULL
  END::numeric(15,3),
  'min_max'
FROM public.products p
JOIN public.store_locations sl
  ON sl.business_id = p.business_id AND sl.is_default
WHERE NOT COALESCE(p.is_service, false)
  AND p.deleted_at IS NULL
ON CONFLICT (business_id, location_id, product_id) DO NOTHING;

ALTER TABLE public.store_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_location_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_locations_select_members
  ON public.store_locations FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

CREATE POLICY store_locations_manage_business_admins
  ON public.store_locations FOR ALL TO authenticated
  USING (public.has_business_role(business_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['owner', 'admin']));

CREATE POLICY stock_balances_select_members
  ON public.stock_balances FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

CREATE POLICY product_location_settings_select_members
  ON public.product_location_settings FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

CREATE POLICY product_location_settings_manage_finance
  ON public.product_location_settings FOR ALL TO authenticated
  USING (public.has_business_role(business_id, ARRAY['owner', 'admin', 'accountant']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['owner', 'admin', 'accountant']));

GRANT SELECT ON public.store_locations, public.stock_balances, public.product_location_settings TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.stock_balances FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_locations, public.stock_balances, public.product_location_settings TO audit_ledger_rpc_owner;

CREATE OR REPLACE FUNCTION public.apply_stock_balance_delta(
  p_business_id uuid,
  p_location_id uuid,
  p_product_id uuid,
  p_quantity_delta numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $apply_stock_balance_delta$
DECLARE
  v_exists boolean;
  v_rows integer;
BEGIN
  IF p_quantity_delta IS NULL OR p_quantity_delta = 0 THEN
    RETURN;
  END IF;

  SELECT true INTO v_exists
  FROM public.stock_balances sb
  WHERE sb.business_id = p_business_id
    AND sb.location_id = p_location_id
    AND sb.product_id = p_product_id
  FOR UPDATE;

  IF COALESCE(v_exists, false) THEN
    UPDATE public.stock_balances sb
    SET on_hand = sb.on_hand + p_quantity_delta,
        updated_at = now()
    WHERE sb.business_id = p_business_id
      AND sb.location_id = p_location_id
      AND sb.product_id = p_product_id
      AND sb.on_hand + p_quantity_delta >= sb.reserved + sb.quarantined;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'Stock movement would make available stock negative for product % at location %',
        p_product_id, p_location_id;
    END IF;
  ELSE
    IF p_quantity_delta < 0 THEN
      RAISE EXCEPTION 'Cannot relieve stock from a location without an opening balance for product %',
        p_product_id;
    END IF;

    INSERT INTO public.stock_balances (
      business_id, location_id, product_id, on_hand, opening_quantity, opening_snapshot_at
    )
    VALUES (p_business_id, p_location_id, p_product_id, p_quantity_delta, 0, now())
    ON CONFLICT (business_id, location_id, product_id)
    DO UPDATE SET on_hand = public.stock_balances.on_hand + EXCLUDED.on_hand,
                  updated_at = now();
  END IF;
END;
$apply_stock_balance_delta$;

CREATE OR REPLACE FUNCTION public.assign_inventory_transaction_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $assign_inventory_transaction_location$
DECLARE
  v_default_location uuid;
BEGIN
  IF NEW.location_id IS NULL THEN
    SELECT sl.id INTO v_default_location
    FROM public.store_locations sl
    WHERE sl.business_id = NEW.business_id
      AND sl.is_default
      AND sl.is_active;

    IF v_default_location IS NULL THEN
      RAISE EXCEPTION 'This business has no active default store location';
    END IF;

    NEW.location_id := v_default_location;
  END IF;

  IF NEW.destination_location_id IS NOT NULL
     AND NEW.destination_location_id = NEW.location_id THEN
    RAISE EXCEPTION 'A stock transfer must use two different locations';
  END IF;

  RETURN NEW;
END;
$assign_inventory_transaction_location$;

CREATE OR REPLACE FUNCTION public.sync_inventory_transaction_stock_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $sync_inventory_transaction_stock_balance$
DECLARE
  v_delta numeric(15,3);
BEGIN
  IF NEW.type = 'transfer' AND NEW.destination_location_id IS NOT NULL THEN
    PERFORM public.apply_stock_balance_delta(
      NEW.business_id, NEW.location_id, NEW.product_id, -ABS(NEW.quantity)::numeric
    );
    PERFORM public.apply_stock_balance_delta(
      NEW.business_id, NEW.destination_location_id, NEW.product_id, ABS(NEW.quantity)::numeric
    );
    RETURN NEW;
  END IF;

  IF NEW.new_quantity IS NOT NULL AND NEW.previous_quantity IS NOT NULL THEN
    v_delta := (NEW.new_quantity - NEW.previous_quantity)::numeric;
  ELSE
    v_delta := CASE
      WHEN NEW.type IN ('purchase', 'return') THEN ABS(NEW.quantity)::numeric
      WHEN NEW.type IN ('sale', 'damage') THEN -ABS(NEW.quantity)::numeric
      ELSE NULL
    END;
  END IF;

  IF v_delta IS NULL THEN
    RAISE EXCEPTION 'Inventory movement requires previous/new quantities or a supported movement type';
  END IF;

  PERFORM public.apply_stock_balance_delta(
    NEW.business_id, NEW.location_id, NEW.product_id, v_delta
  );
  RETURN NEW;
END;
$sync_inventory_transaction_stock_balance$;

CREATE TRIGGER assign_inventory_transaction_location
  BEFORE INSERT ON public.inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_inventory_transaction_location();

CREATE TRIGGER sync_inventory_transaction_stock_balance
  AFTER INSERT ON public.inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_inventory_transaction_stock_balance();

CREATE OR REPLACE FUNCTION public.initialize_product_store_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $initialize_product_store_stock$
DECLARE
  v_location_id uuid;
BEGIN
  IF COALESCE(NEW.is_service, false) OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT sl.id INTO v_location_id
  FROM public.store_locations sl
  WHERE sl.business_id = NEW.business_id
    AND sl.is_default
    AND sl.is_active;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'Create an active default store location before adding stocked products';
  END IF;

  INSERT INTO public.stock_balances (
    business_id, location_id, product_id, on_hand, opening_quantity, opening_snapshot_at
  )
  VALUES (
    NEW.business_id, v_location_id, NEW.id,
    COALESCE(NEW.stock_quantity, 0)::numeric(15,3),
    COALESCE(NEW.stock_quantity, 0)::numeric(15,3), now()
  )
  ON CONFLICT (business_id, location_id, product_id) DO NOTHING;

  INSERT INTO public.product_location_settings (
    business_id, location_id, product_id, minimum_quantity, reorder_point, replenishment_method
  )
  VALUES (
    NEW.business_id, v_location_id, NEW.id,
    GREATEST(COALESCE(NEW.min_stock_level, 0), 0),
    GREATEST(COALESCE(NEW.min_stock_level, 0), 0),
    'min_max'
  )
  ON CONFLICT (business_id, location_id, product_id) DO NOTHING;

  RETURN NEW;
END;
$initialize_product_store_stock$;

CREATE TRIGGER initialize_product_store_stock
  AFTER INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.initialize_product_store_stock();

REVOKE ALL ON FUNCTION public.apply_stock_balance_delta(uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_inventory_transaction_location() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_inventory_transaction_stock_balance() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.initialize_product_store_stock() FROM PUBLIC, anon, authenticated, service_role;


-- New businesses must receive a default location in the same transaction as
-- business creation. Keep this internal trigger outside public so the global
-- public SECURITY DEFINER owner event trigger does not reassign it to the
-- constrained RPC owner before the creator has an active membership claim.
CREATE SCHEMA IF NOT EXISTS app_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.create_default_store_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $create_default_store_location$
BEGIN
  INSERT INTO public.store_locations (
    business_id, code, name, location_type, timezone, is_default
  )
  VALUES (
    NEW.id, 'MAIN', COALESCE(NULLIF(btrim(NEW.name), ''), 'Main Store'),
    'store', COALESCE(NULLIF(btrim(NEW.timezone), ''), 'Africa/Accra'), true
  )
  ON CONFLICT (business_id, code) DO NOTHING;

  RETURN NEW;
END;
$create_default_store_location$;

REVOKE ALL ON FUNCTION app_private.create_default_store_location()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER businesses_create_default_store_location
  AFTER INSERT ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION app_private.create_default_store_location();

NOTIFY pgrst, 'reload schema';
COMMIT;
