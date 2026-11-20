-- Scope stock-count adjustment posting to the trusted active business.
-- Idempotency and all source/account/journal reads are tenant-bound.
ALTER TABLE public.inventory_count_adjustments
  DROP CONSTRAINT IF EXISTS inventory_count_adjustments_idempotency_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_count_adjustments_business_idempotency_uidx
  ON public.inventory_count_adjustments (business_id, idempotency_key);

DROP POLICY IF EXISTS inventory_count_adjustments_finance_read
  ON public.inventory_count_adjustments;
CREATE POLICY inventory_count_adjustments_finance_read
  ON public.inventory_count_adjustments
  FOR SELECT TO authenticated
  USING (public.has_business_role(
    business_id, ARRAY['owner','admin','accountant','auditor']::text[]
  ));

CREATE OR REPLACE FUNCTION public.record_stock_count_adjustment(
  p_product_id uuid,
  p_counted_quantity integer,
  p_counted_on date,
  p_reason text,
  p_reference_number text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $record_stock_count$
DECLARE
  v_business_id uuid;
  v_product public.products%ROWTYPE;
  v_existing public.inventory_count_adjustments%ROWTYPE;
  v_adjustment_id uuid;
  v_transaction_id uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_inventory_account uuid;
  v_variance_account uuid;
  v_system_quantity integer;
  v_delta integer;
  v_unit_cost numeric(14,4);
  v_value numeric(14,2);
  v_currency text;
  v_latest_movement date;
BEGIN
  v_business_id := public.current_business_id();
  IF auth.uid() IS NULL OR v_business_id IS NULL
     OR NOT public.has_business_role(v_business_id, ARRAY['owner','admin','accountant']::text[]) THEN
    RAISE EXCEPTION 'Only an active business owner, admin or accountant can approve stock-count corrections'
      USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL OR p_counted_quantity IS NULL OR p_counted_quantity < 0
     OR p_counted_on IS NULL OR p_counted_on > CURRENT_DATE
     OR NULLIF(BTRIM(p_reason), '') IS NULL
     OR NULLIF(BTRIM(p_reference_number), '') IS NULL
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Product, non-negative counted quantity, valid count date, reason, reference and idempotency key are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':' || p_idempotency_key::text, 0));
  SELECT * INTO v_existing
  FROM public.inventory_count_adjustments
  WHERE business_id = v_business_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.product_id <> p_product_id
       OR v_existing.counted_quantity <> p_counted_quantity
       OR v_existing.counted_on <> p_counted_on
       OR v_existing.reason <> BTRIM(p_reason)
       OR v_existing.reference_number <> BTRIM(p_reference_number) THEN
      RAISE EXCEPTION 'This stock-count idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id AND business_id = v_business_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_product.is_service, false) THEN
    RAISE EXCEPTION 'Select an active physical inventory product';
  END IF;

  v_system_quantity := COALESCE(v_product.stock_quantity, 0);
  v_delta := p_counted_quantity - v_system_quantity;
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'The counted quantity matches the system balance; no adjustment is required';
  END IF;
  IF NOT COALESCE(v_product.cost_price_verified, false)
     OR v_product.cost_price IS NULL OR v_product.cost_price < 0 THEN
    RAISE EXCEPTION 'Verify the actual weighted-average purchase cost before adjusting stock';
  END IF;

  SELECT max(created_at::date) INTO v_latest_movement
  FROM public.inventory_transactions
  WHERE product_id = p_product_id AND business_id = v_business_id;
  IF v_latest_movement IS NOT NULL AND p_counted_on < v_latest_movement THEN
    RAISE EXCEPTION 'The count date cannot predate the latest recorded inventory movement';
  END IF;

  v_unit_cost := v_product.cost_price;
  v_value := ROUND(abs(v_delta) * v_unit_cost, 2);
  IF v_value <= 0 THEN
    RAISE EXCEPTION 'A zero-valued inventory correction cannot be posted';
  END IF;

  SELECT id INTO v_inventory_account
  FROM public.chart_of_accounts
  WHERE business_id = v_business_id AND code = '1200' AND account_type = 'asset' AND is_active LIMIT 1;
  IF v_delta > 0 THEN
    SELECT id INTO v_variance_account
    FROM public.chart_of_accounts
    WHERE business_id = v_business_id AND code = '4900' AND account_type = 'revenue' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_variance_account
    FROM public.chart_of_accounts
    WHERE business_id = v_business_id AND code = '6500' AND account_type = 'expense' AND is_active LIMIT 1;
  END IF;
  IF v_inventory_account IS NULL OR v_variance_account IS NULL THEN
    RAISE EXCEPTION 'Inventory or stock-count variance account is not configured';
  END IF;

  PERFORM set_config('app.inventory_adjustment_rpc', 'on', true);
  UPDATE public.products
  SET stock_quantity = p_counted_quantity
  WHERE id = p_product_id AND business_id = v_business_id;

  INSERT INTO public.inventory_transactions (
    business_id, product_id, type, quantity, previous_quantity, new_quantity,
    unit_cost, total_cost, reference_type, reference_number, notes,
    performed_by
  )
  VALUES (
    v_business_id, p_product_id, 'adjustment', abs(v_delta), v_system_quantity,
    p_counted_quantity, v_unit_cost, v_value, 'inventory_count',
    BTRIM(p_reference_number), BTRIM(p_reason), auth.uid()
  )
  RETURNING id INTO v_transaction_id;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings WHERE business_id = v_business_id ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    business_id, entry_number, entry_date, description, source_type, source_id, currency, created_by
  )
  VALUES (
    v_business_id, v_entry_number, p_counted_on,
    'Stock count correction - ' || v_product.name || ' - ' || BTRIM(p_reference_number),
    'inventory_count_adjustment', v_transaction_id, v_currency, auth.uid()
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.inventory_count_adjustments (
    business_id, product_id, counted_on, system_quantity, counted_quantity, quantity_delta,
    unit_cost, adjustment_value, reason, reference_number,
    inventory_transaction_id, journal_entry_id, idempotency_key, recorded_by
  )
  VALUES (
    v_business_id, p_product_id, p_counted_on, v_system_quantity, p_counted_quantity, v_delta,
    v_unit_cost, v_value, BTRIM(p_reason), BTRIM(p_reference_number),
    v_transaction_id, v_journal_id, p_idempotency_key, auth.uid()
  )
  RETURNING id INTO v_adjustment_id;

  -- The journal source points at the immutable inventory movement for audit joins.
  INSERT INTO public.journal_lines (
    business_id, journal_entry_id, line_number, account_id, description, debit, credit
  )
  VALUES
    (v_business_id, v_journal_id, 1, v_inventory_account,
     'Inventory count increase - ' || v_product.name,
     CASE WHEN v_delta > 0 THEN v_value ELSE 0 END,
     CASE WHEN v_delta < 0 THEN v_value ELSE 0 END),
    (v_business_id, v_journal_id, 2, v_variance_account,
     CASE WHEN v_delta > 0 THEN 'Inventory count variance gain - ' || v_product.name
          ELSE 'Inventory count shortage - ' || v_product.name END,
     CASE WHEN v_delta < 0 THEN v_value ELSE 0 END,
     CASE WHEN v_delta > 0 THEN v_value ELSE 0 END);

  RETURN v_adjustment_id;
END;
$record_stock_count$;

REVOKE ALL ON FUNCTION public.record_stock_count_adjustment(uuid, integer, date, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_count_adjustment(uuid, integer, date, text, text, uuid)
  TO authenticated;
ALTER FUNCTION public.record_stock_count_adjustment(uuid, integer, date, text, text, uuid)
  OWNER TO audit_ledger_rpc_owner;
