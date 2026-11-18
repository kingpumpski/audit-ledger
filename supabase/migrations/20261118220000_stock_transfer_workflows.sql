-- Audited inter-location stock transfers with an explicit in-transit location.
BEGIN;

-- Every business needs a virtual transit location so dispatch and receipt are
-- separate, traceable movements rather than an instant source-to-destination jump.
ALTER TABLE public.store_locations DISABLE TRIGGER audit_activity_store_locations;

INSERT INTO public.store_locations (
  business_id, code, name, location_type, timezone, is_default, is_active
)
SELECT b.id, 'IN-TRANSIT', 'In Transit', 'virtual',
       COALESCE(NULLIF(btrim(b.timezone), ''), 'Africa/Accra'), false, true
FROM public.businesses b
ON CONFLICT (business_id, code) DO NOTHING;

ALTER TABLE public.store_locations ENABLE TRIGGER audit_activity_store_locations;

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

  INSERT INTO public.store_locations (
    business_id, code, name, location_type, timezone, is_default
  )
  VALUES (
    NEW.id, 'IN-TRANSIT', 'In Transit', 'virtual',
    COALESCE(NULLIF(btrim(NEW.timezone), ''), 'Africa/Accra'), false
  )
  ON CONFLICT (business_id, code) DO NOTHING;

  RETURN NEW;
END;
$create_default_store_location$;

CREATE TABLE public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  reference_number text NOT NULL,
  source_location_id uuid NOT NULL,
  destination_location_id uuid NOT NULL,
  transit_location_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'in_transit', 'partially_received', 'received', 'canceled')),
  notes text,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL,
  dispatch_idempotency_key uuid,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  dispatched_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  dispatched_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT stock_transfers_reference_nonblank CHECK (length(btrim(reference_number)) > 0),
  CONSTRAINT stock_transfers_distinct_locations CHECK (
    source_location_id <> destination_location_id
    AND source_location_id <> transit_location_id
    AND destination_location_id <> transit_location_id
  ),
  CONSTRAINT stock_transfers_business_id_key UNIQUE (business_id, id),
  CONSTRAINT stock_transfers_idempotency_key UNIQUE (business_id, idempotency_key),
  CONSTRAINT stock_transfers_dispatch_idempotency_key UNIQUE (business_id, dispatch_idempotency_key),
  CONSTRAINT stock_transfers_reference_key UNIQUE (business_id, reference_number),
  CONSTRAINT stock_transfers_source_location_fk
    FOREIGN KEY (business_id, source_location_id)
    REFERENCES public.store_locations (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_transfers_destination_location_fk
    FOREIGN KEY (business_id, destination_location_id)
    REFERENCES public.store_locations (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_transfers_transit_location_fk
    FOREIGN KEY (business_id, transit_location_id)
    REFERENCES public.store_locations (business_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_stock_transfers_business_source_location
  ON public.stock_transfers (business_id, source_location_id);
CREATE INDEX idx_stock_transfers_business_destination_location
  ON public.stock_transfers (business_id, destination_location_id);
CREATE INDEX idx_stock_transfers_business_transit_location
  ON public.stock_transfers (business_id, transit_location_id);
CREATE INDEX idx_stock_transfers_created_by
  ON public.stock_transfers (created_by);
CREATE INDEX idx_stock_transfers_approved_by
  ON public.stock_transfers (approved_by);
CREATE INDEX idx_stock_transfers_dispatched_by
  ON public.stock_transfers (dispatched_by);

CREATE TABLE public.stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  transfer_id uuid NOT NULL,
  product_id uuid NOT NULL,
  requested_quantity integer NOT NULL,
  dispatched_quantity integer NOT NULL DEFAULT 0,
  received_quantity integer NOT NULL DEFAULT 0,
  dispatch_inventory_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfer_lines_quantities CHECK (
    requested_quantity > 0
    AND dispatched_quantity >= 0
    AND received_quantity >= 0
    AND received_quantity <= dispatched_quantity
    AND dispatched_quantity <= requested_quantity
  ),
  CONSTRAINT stock_transfer_lines_business_id_key UNIQUE (business_id, id),
  CONSTRAINT stock_transfer_lines_transfer_product_key UNIQUE (business_id, transfer_id, product_id),
  CONSTRAINT stock_transfer_lines_transfer_fk
    FOREIGN KEY (business_id, transfer_id)
    REFERENCES public.stock_transfers (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_transfer_lines_product_fk
    FOREIGN KEY (business_id, product_id)
    REFERENCES public.products (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_transfer_lines_dispatch_transaction_fk
    FOREIGN KEY (business_id, dispatch_inventory_transaction_id)
    REFERENCES public.inventory_transactions (business_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_stock_transfer_lines_business_transfer
  ON public.stock_transfer_lines (business_id, transfer_id);
CREATE INDEX idx_stock_transfer_lines_business_product
  ON public.stock_transfer_lines (business_id, product_id);
CREATE INDEX idx_stock_transfer_lines_dispatch_transaction
  ON public.stock_transfer_lines (business_id, dispatch_inventory_transaction_id);

CREATE TABLE public.stock_transfer_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  transfer_id uuid NOT NULL,
  receipt_reference text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL,
  notes text,
  received_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfer_receipts_reference_nonblank CHECK (length(btrim(receipt_reference)) > 0),
  CONSTRAINT stock_transfer_receipts_business_id_key UNIQUE (business_id, id),
  CONSTRAINT stock_transfer_receipts_idempotency_key UNIQUE (business_id, idempotency_key),
  CONSTRAINT stock_transfer_receipts_reference_key UNIQUE (business_id, receipt_reference),
  CONSTRAINT stock_transfer_receipts_transfer_fk
    FOREIGN KEY (business_id, transfer_id)
    REFERENCES public.stock_transfers (business_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_stock_transfer_receipts_business_transfer
  ON public.stock_transfer_receipts (business_id, transfer_id);
CREATE INDEX idx_stock_transfer_receipts_received_by
  ON public.stock_transfer_receipts (received_by);

CREATE TABLE public.stock_transfer_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL,
  transfer_line_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  inventory_transaction_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfer_receipt_lines_business_id_key UNIQUE (business_id, id),
  CONSTRAINT stock_transfer_receipt_lines_receipt_transfer_line_key
    UNIQUE (business_id, receipt_id, transfer_line_id),
  CONSTRAINT stock_transfer_receipt_lines_receipt_fk
    FOREIGN KEY (business_id, receipt_id)
    REFERENCES public.stock_transfer_receipts (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_transfer_receipt_lines_transfer_line_fk
    FOREIGN KEY (business_id, transfer_line_id)
    REFERENCES public.stock_transfer_lines (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_transfer_receipt_lines_product_fk
    FOREIGN KEY (business_id, product_id)
    REFERENCES public.products (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_transfer_receipt_lines_inventory_transaction_fk
    FOREIGN KEY (business_id, inventory_transaction_id)
    REFERENCES public.inventory_transactions (business_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_stock_transfer_receipt_lines_business_receipt
  ON public.stock_transfer_receipt_lines (business_id, receipt_id);
CREATE INDEX idx_stock_transfer_receipt_lines_transfer_line
  ON public.stock_transfer_receipt_lines (business_id, transfer_line_id);
CREATE INDEX idx_stock_transfer_receipt_lines_product
  ON public.stock_transfer_receipt_lines (business_id, product_id);
CREATE INDEX idx_stock_transfer_receipt_lines_inventory_transaction
  ON public.stock_transfer_receipt_lines (business_id, inventory_transaction_id);

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_receipt_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_transfers_select_members
  ON public.stock_transfers FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY stock_transfer_lines_select_members
  ON public.stock_transfer_lines FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY stock_transfer_receipts_select_members
  ON public.stock_transfer_receipts FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY stock_transfer_receipt_lines_select_members
  ON public.stock_transfer_receipt_lines FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

GRANT SELECT ON public.stock_transfers, public.stock_transfer_lines,
  public.stock_transfer_receipts, public.stock_transfer_receipt_lines TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.stock_transfers, public.stock_transfer_lines,
  public.stock_transfer_receipts, public.stock_transfer_receipt_lines FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfers, public.stock_transfer_lines,
  public.stock_transfer_receipts, public.stock_transfer_receipt_lines TO audit_ledger_rpc_owner;

CREATE TRIGGER audit_activity_stock_transfers
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_activity_stock_transfer_lines
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_transfer_lines
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_activity_stock_transfer_receipts
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_transfer_receipts
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_activity_stock_transfer_receipt_lines
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_transfer_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE OR REPLACE FUNCTION public.create_stock_transfer(
  p_source_location_id uuid,
  p_destination_location_id uuid,
  p_reference_number text,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $create_stock_transfer$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_transfer_id uuid;
  v_transit_location_id uuid;
  v_fingerprint text;
  v_existing public.stock_transfers%ROWTYPE;
  v_line_count integer;
  v_distinct_products integer;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL
     OR NOT public.has_business_role(v_business_id, ARRAY['owner', 'admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to create stock transfers' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'A transfer idempotency key is required' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_reference_number), '') IS NULL THEN
    RAISE EXCEPTION 'A transfer reference is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Stock transfer lines must be supplied as a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) = 0 OR jsonb_array_length(p_lines) > 500 THEN
    RAISE EXCEPTION 'A stock transfer must contain between 1 and 500 lines' USING ERRCODE = '22023';
  END IF;
  IF p_source_location_id IS NULL OR p_destination_location_id IS NULL
     OR p_source_location_id = p_destination_location_id THEN
    RAISE EXCEPTION 'Choose two different source and destination locations' USING ERRCODE = '22023';
  END IF;

  v_fingerprint := md5(jsonb_build_object(
    'source_location_id', p_source_location_id,
    'destination_location_id', p_destination_location_id,
    'reference_number', btrim(p_reference_number),
    'notes', NULLIF(btrim(p_notes), ''),
    'lines', p_lines
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_existing
  FROM public.stock_transfers
  WHERE business_id = v_business_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This transfer idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.store_locations sl
    WHERE sl.business_id = v_business_id
      AND sl.id = p_source_location_id
      AND sl.is_active
      AND sl.location_type IN ('store', 'warehouse', 'van')
  ) OR NOT EXISTS (
    SELECT 1 FROM public.store_locations sl
    WHERE sl.business_id = v_business_id
      AND sl.id = p_destination_location_id
      AND sl.is_active
      AND sl.location_type IN ('store', 'warehouse', 'van')
  ) THEN
    RAISE EXCEPTION 'Both transfer locations must be active physical store locations';
  END IF;

  SELECT sl.id INTO v_transit_location_id
  FROM public.store_locations sl
  WHERE sl.business_id = v_business_id
    AND sl.code = 'IN-TRANSIT'
    AND sl.location_type = 'virtual'
    AND sl.is_active;
  IF v_transit_location_id IS NULL THEN
    RAISE EXCEPTION 'The business transit location is not configured';
  END IF;

  SELECT count(*)::integer, count(DISTINCT x.product_id)::integer
  INTO v_line_count, v_distinct_products
  FROM jsonb_to_recordset(p_lines) AS x(product_id uuid, quantity integer);
  IF v_line_count = 0 OR v_line_count <> v_distinct_products THEN
    RAISE EXCEPTION 'Transfer lines must contain unique product IDs';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(product_id uuid, quantity integer)
    WHERE x.product_id IS NULL OR x.quantity IS NULL OR x.quantity <= 0
  ) THEN
    RAISE EXCEPTION 'Every transfer line requires a product and positive whole-unit quantity';
  END IF;
  IF (
    SELECT count(*) FROM jsonb_to_recordset(p_lines) AS x(product_id uuid, quantity integer)
    JOIN public.products p ON p.id = x.product_id AND p.business_id = v_business_id
    WHERE p.deleted_at IS NULL AND COALESCE(p.is_service, false) = false
  ) <> v_line_count THEN
    RAISE EXCEPTION 'Every transfer product must be an active physical product in this business';
  END IF;

  INSERT INTO public.stock_transfers (
    business_id, reference_number, source_location_id, destination_location_id,
    transit_location_id, notes, idempotency_key, request_fingerprint, created_by
  )
  VALUES (
    v_business_id, btrim(p_reference_number), p_source_location_id, p_destination_location_id,
    v_transit_location_id, NULLIF(btrim(p_notes), ''), p_idempotency_key,
    v_fingerprint, auth.uid()
  )
  RETURNING id INTO v_transfer_id;

  INSERT INTO public.stock_transfer_lines (business_id, transfer_id, product_id, requested_quantity)
  SELECT v_business_id, v_transfer_id, x.product_id, x.quantity
  FROM jsonb_to_recordset(p_lines) AS x(product_id uuid, quantity integer);

  RETURN v_transfer_id;
END;
$create_stock_transfer$;

CREATE OR REPLACE FUNCTION public.approve_stock_transfer(p_transfer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $approve_stock_transfer$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_transfer public.stock_transfers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL
     OR NOT public.has_business_role(v_business_id, ARRAY['owner', 'admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only a business owner, administrator or accountant can approve stock transfers'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id AND business_id = v_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock transfer was not found';
  END IF;
  IF v_transfer.status = 'approved' THEN
    RETURN v_transfer.id;
  END IF;
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft stock transfers can be approved';
  END IF;

  UPDATE public.stock_transfers
  SET status = 'approved', approved_by = auth.uid(), approved_at = now()
  WHERE id = v_transfer.id;

  RETURN v_transfer.id;
END;
$approve_stock_transfer$;

CREATE OR REPLACE FUNCTION public.dispatch_stock_transfer(
  p_transfer_id uuid,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $dispatch_stock_transfer$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_transfer public.stock_transfers%ROWTYPE;
  v_line public.stock_transfer_lines%ROWTYPE;
  v_balance public.stock_balances%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_transaction_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL
     OR NOT public.has_business_role(v_business_id, ARRAY['owner', 'admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to dispatch stock transfers' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'A dispatch idempotency key is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id AND business_id = v_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock transfer was not found';
  END IF;
  IF v_transfer.dispatch_idempotency_key IS NOT NULL THEN
    IF v_transfer.dispatch_idempotency_key = p_idempotency_key THEN
      RETURN v_transfer.id;
    END IF;
    RAISE EXCEPTION 'This stock transfer has already been dispatched';
  END IF;
  IF v_transfer.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved stock transfers can be dispatched';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.store_locations sl
    WHERE sl.business_id = v_business_id
      AND sl.id IN (v_transfer.source_location_id, v_transfer.destination_location_id, v_transfer.transit_location_id)
      AND sl.is_active
    GROUP BY sl.business_id
    HAVING count(*) = 3
  ) THEN
    RAISE EXCEPTION 'All source, destination and transit locations must remain active before dispatch';
  END IF;

  FOR v_line IN
    SELECT * FROM public.stock_transfer_lines
    WHERE business_id = v_business_id AND transfer_id = v_transfer.id
    ORDER BY product_id
    FOR UPDATE
  LOOP
    SELECT * INTO v_balance
    FROM public.stock_balances
    WHERE business_id = v_business_id
      AND location_id = v_transfer.source_location_id
      AND product_id = v_line.product_id
    FOR UPDATE;
    IF NOT FOUND OR v_balance.available_quantity < v_line.requested_quantity THEN
      RAISE EXCEPTION 'Insufficient available stock for transfer line %', v_line.id
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE business_id = v_business_id AND id = v_line.product_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_product.is_service, false) OR NOT COALESCE(v_product.is_active, true) THEN
      RAISE EXCEPTION 'Transfer product is no longer an active physical product';
    END IF;

    INSERT INTO public.inventory_transactions (
      product_id, type, quantity, previous_quantity, new_quantity,
      unit_cost, total_cost, reference_type, reference_id, reference_number,
      location_id, destination_location_id, notes, performed_by, idempotency_key
    )
    VALUES (
      v_line.product_id, 'transfer', v_line.requested_quantity,
      COALESCE(v_product.stock_quantity, 0), COALESCE(v_product.stock_quantity, 0),
      CASE WHEN COALESCE(v_product.cost_price_verified, false) THEN v_product.cost_price ELSE NULL END,
      CASE WHEN COALESCE(v_product.cost_price_verified, false)
        THEN ROUND(v_line.requested_quantity * v_product.cost_price, 2) ELSE NULL END,
      'stock_transfer_dispatch', v_transfer.id, v_transfer.reference_number,
      v_transfer.source_location_id, v_transfer.transit_location_id,
      v_transfer.notes, auth.uid(), gen_random_uuid()
    )
    RETURNING id INTO v_transaction_id;

    UPDATE public.stock_transfer_lines
    SET dispatched_quantity = requested_quantity,
        dispatch_inventory_transaction_id = v_transaction_id
    WHERE id = v_line.id;
  END LOOP;

  UPDATE public.stock_transfers
  SET status = 'in_transit',
      dispatched_by = auth.uid(),
      dispatched_at = now(),
      dispatch_idempotency_key = p_idempotency_key
  WHERE id = v_transfer.id;

  RETURN v_transfer.id;
END;
$dispatch_stock_transfer$;

CREATE OR REPLACE FUNCTION public.receive_stock_transfer(
  p_transfer_id uuid,
  p_receipt_reference text,
  p_lines jsonb,
  p_idempotency_key uuid,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $receive_stock_transfer$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_transfer public.stock_transfers%ROWTYPE;
  v_line public.stock_transfer_lines%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_receipt public.stock_transfer_receipts%ROWTYPE;
  v_receipt_id uuid;
  v_transaction_id uuid;
  v_fingerprint text;
  v_line_count integer;
  v_distinct_lines integer;
  v_quantity integer;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL
     OR NOT public.has_business_role(v_business_id, ARRAY['owner', 'admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to receive stock transfers' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR NULLIF(btrim(p_receipt_reference), '') IS NULL THEN
    RAISE EXCEPTION 'A receipt reference and idempotency key are required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Received transfer lines must be supplied as a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) = 0 OR jsonb_array_length(p_lines) > 500 THEN
    RAISE EXCEPTION 'A transfer receipt must contain between 1 and 500 lines' USING ERRCODE = '22023';
  END IF;

  v_fingerprint := md5(jsonb_build_object(
    'transfer_id', p_transfer_id,
    'receipt_reference', btrim(p_receipt_reference),
    'notes', NULLIF(btrim(p_notes), ''),
    'lines', p_lines
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_receipt
  FROM public.stock_transfer_receipts
  WHERE business_id = v_business_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.transfer_id <> p_transfer_id
       OR v_receipt.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This receipt idempotency key was already used with different details';
    END IF;
    RETURN v_receipt.id;
  END IF;

  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id AND business_id = v_business_id
  FOR UPDATE;
  IF NOT FOUND OR v_transfer.status NOT IN ('in_transit', 'partially_received') THEN
    RAISE EXCEPTION 'Only stock transfers in transit can be received';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.store_locations sl
    WHERE sl.business_id = v_business_id
      AND sl.id IN (v_transfer.transit_location_id, v_transfer.destination_location_id)
      AND sl.is_active
    GROUP BY sl.business_id
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'Transit and destination locations must remain active before receipt';
  END IF;

  SELECT count(*)::integer, count(DISTINCT x.transfer_line_id)::integer
  INTO v_line_count, v_distinct_lines
  FROM jsonb_to_recordset(p_lines) AS x(transfer_line_id uuid, quantity integer);
  IF v_line_count = 0 OR v_line_count <> v_distinct_lines THEN
    RAISE EXCEPTION 'Receipt lines must contain unique transfer line IDs';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(transfer_line_id uuid, quantity integer)
    WHERE x.transfer_line_id IS NULL OR x.quantity IS NULL OR x.quantity <= 0
  ) THEN
    RAISE EXCEPTION 'Every receipt line requires a transfer line and positive whole-unit quantity';
  END IF;
  IF (
    SELECT count(*) FROM jsonb_to_recordset(p_lines) AS x(transfer_line_id uuid, quantity integer)
    JOIN public.stock_transfer_lines tl
      ON tl.id = x.transfer_line_id
     AND tl.business_id = v_business_id
     AND tl.transfer_id = v_transfer.id
  ) <> v_line_count THEN
    RAISE EXCEPTION 'Every received line must belong to this stock transfer';
  END IF;

  INSERT INTO public.stock_transfer_receipts (
    business_id, transfer_id, receipt_reference, idempotency_key,
    request_fingerprint, notes, received_by
  )
  VALUES (
    v_business_id, v_transfer.id, btrim(p_receipt_reference), p_idempotency_key,
    v_fingerprint, NULLIF(btrim(p_notes), ''), auth.uid()
  )
  RETURNING id INTO v_receipt_id;

  FOR v_line IN
    SELECT tl.*
    FROM jsonb_to_recordset(p_lines) AS x(transfer_line_id uuid, quantity integer)
    JOIN public.stock_transfer_lines tl
      ON tl.id = x.transfer_line_id
     AND tl.business_id = v_business_id
     AND tl.transfer_id = v_transfer.id
    ORDER BY tl.product_id
    FOR UPDATE OF tl
  LOOP
    SELECT x.quantity INTO v_quantity
    FROM jsonb_to_recordset(p_lines) AS x(transfer_line_id uuid, quantity integer)
    WHERE x.transfer_line_id = v_line.id;

    IF v_quantity > v_line.dispatched_quantity - v_line.received_quantity THEN
      RAISE EXCEPTION 'Received quantity exceeds the outstanding in-transit quantity for line %', v_line.id;
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE business_id = v_business_id AND id = v_line.product_id
    FOR UPDATE;

    INSERT INTO public.inventory_transactions (
      product_id, type, quantity, previous_quantity, new_quantity,
      unit_cost, total_cost, reference_type, reference_id, reference_number,
      location_id, destination_location_id, notes, performed_by, idempotency_key
    )
    VALUES (
      v_line.product_id, 'transfer', v_quantity,
      COALESCE(v_product.stock_quantity, 0), COALESCE(v_product.stock_quantity, 0),
      CASE WHEN COALESCE(v_product.cost_price_verified, false) THEN v_product.cost_price ELSE NULL END,
      CASE WHEN COALESCE(v_product.cost_price_verified, false)
        THEN ROUND(v_quantity * v_product.cost_price, 2) ELSE NULL END,
      'stock_transfer_receipt', v_receipt_id, btrim(p_receipt_reference),
      v_transfer.transit_location_id, v_transfer.destination_location_id,
      NULLIF(btrim(p_notes), ''), auth.uid(), gen_random_uuid()
    )
    RETURNING id INTO v_transaction_id;

    INSERT INTO public.stock_transfer_receipt_lines (
      business_id, receipt_id, transfer_line_id, product_id, quantity, inventory_transaction_id
    )
    VALUES (
      v_business_id, v_receipt_id, v_line.id, v_line.product_id, v_quantity, v_transaction_id
    );

    UPDATE public.stock_transfer_lines
    SET received_quantity = received_quantity + v_quantity
    WHERE id = v_line.id;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.stock_transfer_lines
    WHERE business_id = v_business_id
      AND transfer_id = v_transfer.id
      AND received_quantity < dispatched_quantity
  ) THEN
    UPDATE public.stock_transfers
    SET status = 'received', completed_at = now()
    WHERE id = v_transfer.id;
  ELSE
    UPDATE public.stock_transfers
    SET status = 'partially_received'
    WHERE id = v_transfer.id;
  END IF;

  RETURN v_receipt_id;
END;
$receive_stock_transfer$;

REVOKE ALL ON FUNCTION public.create_stock_transfer(uuid, uuid, text, text, jsonb, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_stock_transfer(uuid, uuid, text, text, jsonb, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.approve_stock_transfer(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_stock_transfer(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.dispatch_stock_transfer(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_stock_transfer(uuid, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.receive_stock_transfer(uuid, text, jsonb, uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.receive_stock_transfer(uuid, text, jsonb, uuid, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
