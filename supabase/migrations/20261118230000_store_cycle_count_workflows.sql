-- Blind, location-scoped cycle counts with movement freeze and independent approval.
BEGIN;

CREATE TABLE public.store_stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL,
  reference_number text NOT NULL,
  status text NOT NULL DEFAULT 'counting'
    CHECK (status IN ('counting', 'submitted', 'approved', 'posted', 'canceled')),
  notes text,
  line_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(line_snapshot) = 'array'),
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL,
  posting_idempotency_key uuid,
  journal_entry_id uuid,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  submitted_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  posted_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  canceled_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  posted_at timestamptz,
  canceled_at timestamptz,
  CONSTRAINT store_stock_counts_reference_nonblank CHECK (length(btrim(reference_number)) > 0),
  CONSTRAINT store_stock_counts_business_id_key UNIQUE (business_id, id),
  CONSTRAINT store_stock_counts_idempotency_key UNIQUE (business_id, idempotency_key),
  CONSTRAINT store_stock_counts_posting_idempotency_key UNIQUE (business_id, posting_idempotency_key),
  CONSTRAINT store_stock_counts_reference_key UNIQUE (business_id, reference_number),
  CONSTRAINT store_stock_counts_location_fk
    FOREIGN KEY (business_id, location_id)
    REFERENCES public.store_locations (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT store_stock_counts_journal_fk
    FOREIGN KEY (business_id, journal_entry_id)
    REFERENCES public.journal_entries (business_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_store_stock_counts_one_active_per_location
  ON public.store_stock_counts (business_id, location_id)
  WHERE status IN ('counting', 'submitted', 'approved');
CREATE INDEX idx_store_stock_counts_business_created
  ON public.store_stock_counts (business_id, created_at DESC);
CREATE INDEX idx_store_stock_counts_business_location
  ON public.store_stock_counts (business_id, location_id);
CREATE INDEX idx_store_stock_counts_business_journal
  ON public.store_stock_counts (business_id, journal_entry_id);
CREATE INDEX idx_store_stock_counts_created_by
  ON public.store_stock_counts (created_by);
CREATE INDEX idx_store_stock_counts_submitted_by
  ON public.store_stock_counts (submitted_by);
CREATE INDEX idx_store_stock_counts_approved_by
  ON public.store_stock_counts (approved_by);
CREATE INDEX idx_store_stock_counts_posted_by
  ON public.store_stock_counts (posted_by);
CREATE INDEX idx_store_stock_counts_canceled_by
  ON public.store_stock_counts (canceled_by);

CREATE TABLE public.store_stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  count_id uuid NOT NULL,
  product_id uuid NOT NULL,
  system_quantity_snapshot integer NOT NULL CHECK (system_quantity_snapshot >= 0),
  counted_quantity integer CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
  counted_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  counted_at timestamptz,
  variance_quantity integer NOT NULL DEFAULT 0,
  unit_cost_snapshot numeric(14,4),
  adjustment_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (adjustment_value >= 0),
  reason text,
  inventory_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_stock_count_lines_business_id_key UNIQUE (business_id, id),
  CONSTRAINT store_stock_count_lines_count_product_key UNIQUE (business_id, count_id, product_id),
  CONSTRAINT store_stock_count_lines_count_fk
    FOREIGN KEY (business_id, count_id)
    REFERENCES public.store_stock_counts (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT store_stock_count_lines_product_fk
    FOREIGN KEY (business_id, product_id)
    REFERENCES public.products (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT store_stock_count_lines_transaction_fk
    FOREIGN KEY (business_id, inventory_transaction_id)
    REFERENCES public.inventory_transactions (business_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_store_stock_count_lines_business_count
  ON public.store_stock_count_lines (business_id, count_id);
CREATE INDEX idx_store_stock_count_lines_business_product
  ON public.store_stock_count_lines (business_id, product_id);
CREATE INDEX idx_store_stock_count_lines_counted_by
  ON public.store_stock_count_lines (counted_by);
CREATE INDEX idx_store_stock_count_lines_inventory_transaction
  ON public.store_stock_count_lines (business_id, inventory_transaction_id);

ALTER TABLE public.store_stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_stock_count_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_stock_counts_select_members
  ON public.store_stock_counts FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY store_stock_count_lines_select_members
  ON public.store_stock_count_lines FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

GRANT SELECT ON public.store_stock_counts, public.store_stock_count_lines TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.store_stock_counts, public.store_stock_count_lines
  FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_stock_counts, public.store_stock_count_lines
  TO audit_ledger_rpc_owner;

CREATE TRIGGER audit_activity_store_stock_counts
  AFTER INSERT OR UPDATE OR DELETE ON public.store_stock_counts
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- The detail table is represented in the count header's immutable line_snapshot
-- and in the authoritative inventory_transactions created when the count posts.
CREATE OR REPLACE FUNCTION app_private.guard_stock_count_location_movements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $guard_stock_count_location_movements$
DECLARE
  v_locked_location uuid;
BEGIN
  IF COALESCE(current_setting('app.store_stock_count_posting', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.location_id IS NULL THEN
    RAISE EXCEPTION 'Inventory movement must resolve to a store location';
  END IF;

  -- Shared advisory locks allow concurrent movements at the same location,
  -- while count creation/cancellation takes an exclusive lock for a clean
  -- snapshot boundary without serializing every sale.
  FOR v_locked_location IN
    SELECT sl.id
    FROM public.store_locations sl
    WHERE sl.business_id = NEW.business_id
      AND sl.id IN (NEW.location_id, NEW.destination_location_id)
    ORDER BY sl.id
  LOOP
    PERFORM pg_advisory_xact_lock_shared(
      hashtextextended(
        NEW.business_id::text || ':' || v_locked_location::text || ':' || NEW.product_id::text,
        0
      )
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.store_stock_counts c
    JOIN public.store_stock_count_lines l
      ON l.business_id = c.business_id AND l.count_id = c.id
    WHERE c.business_id = NEW.business_id
      AND c.status IN ('counting', 'submitted', 'approved')
      AND c.location_id IN (NEW.location_id, NEW.destination_location_id)
      AND l.product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'Inventory movement is paused for a location while a stock count is active'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$guard_stock_count_location_movements$;

REVOKE ALL ON FUNCTION app_private.guard_stock_count_location_movements()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER zz_guard_stock_count_location_movements
  BEFORE INSERT ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_stock_count_location_movements();

CREATE OR REPLACE FUNCTION public.create_store_stock_count(
  p_location_id uuid,
  p_reference_number text,
  p_notes text,
  p_idempotency_key uuid,
  p_product_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $create_store_stock_count$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_existing public.store_stock_counts%ROWTYPE;
  v_location public.store_locations%ROWTYPE;
  v_count_id uuid;
  v_fingerprint text;
  v_initial_snapshot jsonb;
  v_product_ids uuid[];
  v_product_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL
     OR NOT public.has_business_role(v_business_id, ARRAY['owner', 'admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to start a store stock count' USING ERRCODE = '42501';
  END IF;
  IF p_location_id IS NULL OR p_idempotency_key IS NULL
     OR NULLIF(btrim(p_reference_number), '') IS NULL THEN
    RAISE EXCEPTION 'A location, count reference and idempotency key are required' USING ERRCODE = '22023';
  END IF;

  v_fingerprint := md5(jsonb_build_object(
    'location_id', p_location_id,
    'reference_number', btrim(p_reference_number),
    'notes', NULLIF(btrim(p_notes), ''),
    'product_ids', p_product_ids
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_existing
  FROM public.store_stock_counts
  WHERE business_id = v_business_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This count idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_location
  FROM public.store_locations
  WHERE business_id = v_business_id AND id = p_location_id;
  IF NOT FOUND OR NOT v_location.is_active
     OR v_location.location_type NOT IN ('store', 'warehouse', 'van') THEN
    RAISE EXCEPTION 'Choose an active physical store location for the count';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.store_stock_counts
    WHERE business_id = v_business_id
      AND location_id = p_location_id
      AND status IN ('counting', 'submitted', 'approved')
  ) THEN
    RAISE EXCEPTION 'A stock count is already active for this location';
  END IF;

  IF p_product_ids IS NOT NULL AND cardinality(p_product_ids) > 0 THEN
    IF cardinality(p_product_ids) <> (
      SELECT count(DISTINCT selected.product_id)::integer
      FROM unnest(p_product_ids) AS selected(product_id)
    ) THEN
      RAISE EXCEPTION 'Cycle-count product selection contains duplicate IDs';
    END IF;

    SELECT array_agg(p.id ORDER BY p.id)
    INTO v_product_ids
    FROM public.products p
    WHERE p.business_id = v_business_id
      AND p.id = ANY(p_product_ids)
      AND p.deleted_at IS NULL
      AND p.is_active = true
      AND COALESCE(p.is_service, false) = false;

    IF COALESCE(cardinality(v_product_ids), 0) <> cardinality(p_product_ids) THEN
      RAISE EXCEPTION 'Every selected cycle-count product must be an active physical product in this business';
    END IF;
  ELSE
    SELECT array_agg(p.id ORDER BY p.id)
    INTO v_product_ids
    FROM public.products p
    WHERE p.business_id = v_business_id
      AND p.deleted_at IS NULL
      AND p.is_active = true
      AND COALESCE(p.is_service, false) = false;
  END IF;

  IF COALESCE(cardinality(v_product_ids), 0) = 0 THEN
    RAISE EXCEPTION 'The selected location has no active physical products to count';
  END IF;

  -- Lock only the selected location/product pairs. Uncounted SKUs remain
  -- available for normal sales and receipts during a cycle count.
  FOREACH v_product_id IN ARRAY v_product_ids LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_business_id::text || ':' || p_location_id::text || ':' || v_product_id::text, 0)
    );
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.store_stock_counts
    WHERE business_id = v_business_id
      AND location_id = p_location_id
      AND status IN ('counting', 'submitted', 'approved')
  ) THEN
    RAISE EXCEPTION 'A stock count is already active for this location';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', p.id,
    'system_quantity', COALESCE(sb.on_hand, 0),
    'unit_cost', CASE
      WHEN COALESCE(p.cost_price_verified, false) AND p.cost_price IS NOT NULL AND p.cost_price >= 0
        THEN p.cost_price
      ELSE NULL
    END
  ) ORDER BY p.id), '[]'::jsonb)
  INTO v_initial_snapshot
  FROM public.products p
  LEFT JOIN public.stock_balances sb
    ON sb.business_id = v_business_id
   AND sb.location_id = p_location_id
   AND sb.product_id = p.id
  WHERE p.business_id = v_business_id
    AND p.id = ANY(v_product_ids)
    AND p.deleted_at IS NULL
    AND p.is_active = true
    AND COALESCE(p.is_service, false) = false;

  INSERT INTO public.store_stock_counts (
    business_id, location_id, reference_number, notes,
    idempotency_key, request_fingerprint, line_snapshot, created_by
  )
  VALUES (
    v_business_id, p_location_id, btrim(p_reference_number),
    NULLIF(btrim(p_notes), ''), p_idempotency_key, v_fingerprint,
    v_initial_snapshot, auth.uid()
  )
  RETURNING id INTO v_count_id;

  INSERT INTO public.store_stock_count_lines (
    business_id, count_id, product_id, system_quantity_snapshot, unit_cost_snapshot
  )
  SELECT
    v_business_id,
    v_count_id,
    p.id,
    COALESCE(sb.on_hand, 0),
    CASE
      WHEN COALESCE(p.cost_price_verified, false) AND p.cost_price IS NOT NULL AND p.cost_price >= 0
        THEN p.cost_price
      ELSE NULL
    END
  FROM public.products p
  LEFT JOIN public.stock_balances sb
    ON sb.business_id = v_business_id
   AND sb.location_id = p_location_id
   AND sb.product_id = p.id
  WHERE p.business_id = v_business_id
    AND p.id = ANY(v_product_ids)
    AND p.deleted_at IS NULL
    AND p.is_active = true
    AND COALESCE(p.is_service, false) = false
  ORDER BY p.id;

  RETURN v_count_id;
END;
$create_store_stock_count$;

CREATE OR REPLACE FUNCTION public.record_store_stock_count_line(
  p_count_id uuid,
  p_product_id uuid,
  p_counted_quantity integer,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $record_store_stock_count_line$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_count public.store_stock_counts%ROWTYPE;
  v_line public.store_stock_count_lines%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL
     OR NOT public.has_business_role(v_business_id, ARRAY['owner', 'admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to record stock-count quantities' USING ERRCODE = '42501';
  END IF;
  IF p_counted_quantity IS NULL OR p_counted_quantity < 0 THEN
    RAISE EXCEPTION 'Counted quantity must be a non-negative whole number' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_count
  FROM public.store_stock_counts
  WHERE business_id = v_business_id AND id = p_count_id
  FOR UPDATE;
  IF NOT FOUND OR v_count.status <> 'counting' THEN
    RAISE EXCEPTION 'Only an active counting session can accept counted quantities';
  END IF;

  SELECT * INTO v_line
  FROM public.store_stock_count_lines
  WHERE business_id = v_business_id
    AND count_id = v_count.id
    AND product_id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected product is not part of this stock-count snapshot';
  END IF;

  UPDATE public.store_stock_count_lines
  SET counted_quantity = p_counted_quantity,
      counted_by = auth.uid(),
      counted_at = now(),
      reason = NULLIF(btrim(p_reason), '')
  WHERE id = v_line.id;

  RETURN v_line.id;
END;
$record_store_stock_count_line$;

CREATE OR REPLACE FUNCTION public.submit_store_stock_count(p_count_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $submit_store_stock_count$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_count public.store_stock_counts%ROWTYPE;
  v_line_snapshot jsonb;
  v_total_lines integer;
  v_counted_lines integer;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL
     OR NOT public.has_business_role(v_business_id, ARRAY['owner', 'admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to submit a stock count' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_count
  FROM public.store_stock_counts
  WHERE business_id = v_business_id AND id = p_count_id
  FOR UPDATE;
  IF NOT FOUND OR v_count.status <> 'counting' THEN
    RAISE EXCEPTION 'Only an active counting session can be submitted';
  END IF;

  SELECT count(*)::integer, count(counted_quantity)::integer,
         COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', product_id,
           'system_quantity', system_quantity_snapshot,
           'counted_quantity', counted_quantity,
           'counted_by', counted_by,
           'counted_at', counted_at,
           'unit_cost', unit_cost_snapshot,
           'reason', reason
         ) ORDER BY product_id), '[]'::jsonb)
  INTO v_total_lines, v_counted_lines, v_line_snapshot
  FROM public.store_stock_count_lines
  WHERE business_id = v_business_id AND count_id = v_count.id;

  IF v_total_lines = 0 OR v_total_lines <> v_counted_lines THEN
    RAISE EXCEPTION 'Every product in the stock-count snapshot must be counted before submission';
  END IF;

  UPDATE public.store_stock_counts
  SET status = 'submitted',
      submitted_by = auth.uid(),
      submitted_at = now(),
      line_snapshot = v_line_snapshot
  WHERE id = v_count.id;

  RETURN v_count.id;
END;
$submit_store_stock_count$;

CREATE OR REPLACE FUNCTION public.approve_store_stock_count(p_count_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $approve_store_stock_count$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_count public.store_stock_counts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL
     OR NOT public.has_business_role(v_business_id, ARRAY['owner', 'admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only a business owner, administrator or accountant can approve stock counts'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_count
  FROM public.store_stock_counts
  WHERE business_id = v_business_id AND id = p_count_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock count was not found';
  END IF;
  IF v_count.status = 'approved' THEN
    RETURN v_count.id;
  END IF;
  IF v_count.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only submitted stock counts can be approved';
  END IF;
  IF v_count.submitted_by = auth.uid() THEN
    RAISE EXCEPTION 'A different authorized user must approve a submitted stock count';
  END IF;

  UPDATE public.store_stock_counts
  SET status = 'approved', approved_by = auth.uid(), approved_at = now()
  WHERE id = v_count.id;

  RETURN v_count.id;
END;
$approve_store_stock_count$;

CREATE OR REPLACE FUNCTION public.cancel_store_stock_count(
  p_count_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $cancel_store_stock_count$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_count public.store_stock_counts%ROWTYPE;
  v_product_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL
     OR NOT public.has_business_role(v_business_id, ARRAY['owner', 'admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only a business owner, administrator or accountant can cancel stock counts'
      USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_count
  FROM public.store_stock_counts
  WHERE business_id = v_business_id AND id = p_count_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock count was not found';
  END IF;
  IF v_count.status = 'canceled' THEN
    RETURN v_count.id;
  END IF;
  IF v_count.status NOT IN ('counting', 'submitted', 'approved') THEN
    RAISE EXCEPTION 'A posted stock count cannot be canceled; record a new count or adjustment';
  END IF;

  FOR v_product_id IN
    SELECT product_id FROM public.store_stock_count_lines
    WHERE business_id = v_business_id AND count_id = v_count.id
    ORDER BY product_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_business_id::text || ':' || v_count.location_id::text || ':' || v_product_id::text, 0)
    );
  END LOOP;

  UPDATE public.store_stock_counts
  SET status = 'canceled',
      canceled_by = auth.uid(),
      canceled_at = now(),
      cancellation_reason = btrim(p_reason)
  WHERE id = v_count.id;

  RETURN v_count.id;
END;
$cancel_store_stock_count$;

CREATE OR REPLACE FUNCTION public.post_store_stock_count(
  p_count_id uuid,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $post_store_stock_count$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_count public.store_stock_counts%ROWTYPE;
  v_line public.store_stock_count_lines%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_balance public.stock_balances%ROWTYPE;
  v_transaction_id uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_inventory_account uuid;
  v_gain_account uuid;
  v_loss_account uuid;
  v_currency text;
  v_delta integer;
  v_value numeric(14,2);
  v_total_gain numeric(14,2) := 0;
  v_total_loss numeric(14,2) := 0;
  v_line_number integer := 1;
  v_debits numeric(14,2);
  v_credits numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL
     OR NOT public.has_business_role(v_business_id, ARRAY['owner', 'admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only a business owner, administrator or accountant can post stock counts'
      USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'A posting idempotency key is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_count
  FROM public.store_stock_counts
  WHERE business_id = v_business_id AND id = p_count_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock count was not found';
  END IF;
  IF v_count.status = 'posted' THEN
    IF v_count.posting_idempotency_key = p_idempotency_key THEN
      RETURN v_count.id;
    END IF;
    RAISE EXCEPTION 'This stock count has already been posted with a different idempotency key';
  END IF;
  IF v_count.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved stock counts can be posted';
  END IF;

  -- The active count's movement guard prevents any new movement from
  -- committing. Do not take a location row lock here: existing movement RPCs
  -- lock products/balances before the movement guard, and a location lock here
  -- would create a lock-order deadlock.
  -- Verify the freeze held: no stock movement may have changed the snapshot.
  FOR v_line IN
    SELECT * FROM public.store_stock_count_lines
    WHERE business_id = v_business_id AND count_id = v_count.id
    ORDER BY product_id
    FOR UPDATE
  LOOP
    SELECT * INTO v_balance
    FROM public.stock_balances
    WHERE business_id = v_business_id
      AND location_id = v_count.location_id
      AND product_id = v_line.product_id
    FOR UPDATE;

    IF COALESCE(v_balance.on_hand, 0) <> v_line.system_quantity_snapshot THEN
      RAISE EXCEPTION 'Stock changed after the count snapshot for product %; cancel and recount', v_line.product_id;
    END IF;

    v_delta := v_line.counted_quantity - v_line.system_quantity_snapshot;
    IF v_delta = 0 THEN
      CONTINUE;
    END IF;
    IF NULLIF(btrim(v_line.reason), '') IS NULL THEN
      RAISE EXCEPTION 'A reason is required for every stock-count variance';
    END IF;
    IF v_line.unit_cost_snapshot IS NULL OR v_line.unit_cost_snapshot <= 0 THEN
      RAISE EXCEPTION 'Verified inventory cost is required before posting a stock-count variance for product %', v_line.product_id;
    END IF;

    v_value := ROUND(abs(v_delta) * v_line.unit_cost_snapshot, 2);
    IF v_value <= 0 THEN
      RAISE EXCEPTION 'A zero-valued stock-count variance cannot be posted';
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE business_id = v_business_id AND id = v_line.product_id
      AND deleted_at IS NULL AND is_active = true
    FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_product.is_service, false) THEN
      RAISE EXCEPTION 'Counted product is no longer an active physical inventory product';
    END IF;
    IF COALESCE(v_product.stock_quantity, 0) + v_delta < 0 THEN
      RAISE EXCEPTION 'Stock-count correction would make total business stock negative for product %', v_product.id;
    END IF;

    PERFORM set_config('app.inventory_adjustment_rpc', 'on', true);
    PERFORM set_config('app.store_stock_count_posting', 'on', true);
    UPDATE public.products
    SET stock_quantity = COALESCE(stock_quantity, 0) + v_delta
    WHERE id = v_product.id;

    INSERT INTO public.inventory_transactions (
      product_id, type, quantity, previous_quantity, new_quantity,
      unit_cost, total_cost, reference_type, reference_id, reference_number,
      location_id, notes, performed_by, idempotency_key
    )
    VALUES (
      v_product.id, 'adjustment', abs(v_delta),
      COALESCE(v_product.stock_quantity, 0),
      COALESCE(v_product.stock_quantity, 0) + v_delta,
      v_line.unit_cost_snapshot, v_value, 'store_stock_count', v_count.id,
      v_count.reference_number, v_count.location_id, btrim(v_line.reason),
      auth.uid(), gen_random_uuid()
    )
    RETURNING id INTO v_transaction_id;

    UPDATE public.store_stock_count_lines
    SET variance_quantity = v_delta,
        adjustment_value = v_value,
        inventory_transaction_id = v_transaction_id
    WHERE id = v_line.id;

    IF v_delta > 0 THEN
      v_total_gain := v_total_gain + v_value;
    ELSE
      v_total_loss := v_total_loss + v_value;
    END IF;
  END LOOP;

  IF v_total_gain > 0 OR v_total_loss > 0 THEN
    SELECT id INTO v_inventory_account
    FROM public.chart_of_accounts
    WHERE business_id = v_business_id AND code = '1200' AND account_type = 'asset' AND is_active LIMIT 1;
    SELECT id INTO v_gain_account
    FROM public.chart_of_accounts
    WHERE business_id = v_business_id AND code = '4900' AND account_type = 'revenue' AND is_active LIMIT 1;
    SELECT id INTO v_loss_account
    FROM public.chart_of_accounts
    WHERE business_id = v_business_id AND code = '6500' AND account_type = 'expense' AND is_active LIMIT 1;

    IF v_inventory_account IS NULL OR (v_total_gain > 0 AND v_gain_account IS NULL)
       OR (v_total_loss > 0 AND v_loss_account IS NULL) THEN
      RAISE EXCEPTION 'Inventory count variance accounts are not configured';
    END IF;

    v_entry_number := public.get_next_sequence('journal');
    SELECT COALESCE(
      (SELECT cs.currency_code FROM public.company_settings cs
       WHERE cs.business_id = v_business_id ORDER BY cs.created_at LIMIT 1),
      (SELECT b.base_currency FROM public.businesses b WHERE b.id = v_business_id),
      'USD'
    ) INTO v_currency;

    INSERT INTO public.journal_entries (
      entry_number, entry_date, description, source_type, source_id, currency, created_by
    )
    VALUES (
      v_entry_number, CURRENT_DATE,
      'Store stock count - ' || v_count.reference_number,
      'inventory_count_adjustment', v_count.id, v_currency, auth.uid()
    )
    RETURNING id INTO v_journal_id;

    IF v_total_gain > 0 THEN
      INSERT INTO public.journal_lines (
        journal_entry_id, line_number, account_id, description, debit, credit
      )
      VALUES
        (v_journal_id, v_line_number, v_inventory_account,
         'Inventory count increase - ' || v_count.reference_number, v_total_gain, 0),
        (v_journal_id, v_line_number + 1, v_gain_account,
         'Inventory count variance gain - ' || v_count.reference_number, 0, v_total_gain);
      v_line_number := v_line_number + 2;
    END IF;

    IF v_total_loss > 0 THEN
      INSERT INTO public.journal_lines (
        journal_entry_id, line_number, account_id, description, debit, credit
      )
      VALUES
        (v_journal_id, v_line_number, v_loss_account,
         'Inventory shrinkage - ' || v_count.reference_number, v_total_loss, 0),
        (v_journal_id, v_line_number + 1, v_inventory_account,
         'Inventory count shortage - ' || v_count.reference_number, 0, v_total_loss);
    END IF;

    SELECT ROUND(COALESCE(SUM(debit), 0), 2), ROUND(COALESCE(SUM(credit), 0), 2)
    INTO v_debits, v_credits
    FROM public.journal_lines
    WHERE journal_entry_id = v_journal_id;
    IF v_debits <> v_credits THEN
      RAISE EXCEPTION 'Stock-count journal is not balanced';
    END IF;
  END IF;

  -- Scope privileged guard bypasses to this RPC's posting section only.
  PERFORM set_config('app.store_stock_count_posting', 'off', true);
  PERFORM set_config('app.inventory_adjustment_rpc', 'off', true);

  UPDATE public.store_stock_counts
  SET status = 'posted',
      posted_by = auth.uid(),
      posted_at = now(),
      posting_idempotency_key = p_idempotency_key,
      journal_entry_id = v_journal_id,
      line_snapshot = COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_id', product_id,
          'system_quantity', system_quantity_snapshot,
          'counted_quantity', counted_quantity,
          'counted_by', counted_by,
          'counted_at', counted_at,
          'variance_quantity', variance_quantity,
          'unit_cost', unit_cost_snapshot,
          'adjustment_value', adjustment_value,
          'reason', reason,
          'inventory_transaction_id', inventory_transaction_id
        ) ORDER BY product_id)
        FROM public.store_stock_count_lines
        WHERE business_id = v_business_id AND count_id = v_count.id
      ), '[]'::jsonb)
  WHERE id = v_count.id;

  RETURN v_count.id;
END;
$post_store_stock_count$;

REVOKE ALL ON FUNCTION public.create_store_stock_count(uuid, text, text, uuid, uuid[])
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_store_stock_count(uuid, text, text, uuid, uuid[])
  TO authenticated;
REVOKE ALL ON FUNCTION public.record_store_stock_count_line(uuid, uuid, integer, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_store_stock_count_line(uuid, uuid, integer, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.submit_store_stock_count(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.submit_store_stock_count(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.approve_store_stock_count(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_store_stock_count(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_store_stock_count(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_store_stock_count(uuid, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.post_store_stock_count(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.post_store_stock_count(uuid, uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
