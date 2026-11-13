-- Audited stock-count corrections. Never overwrite source purchase/sale history.
ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'invoice'::text, 'payment'::text, 'receipt'::text, 'receipt_void'::text,
    'stock_purchase'::text, 'opening_stock_valuation'::text,
    'petty_cash_expense'::text, 'direct_invoice_cost'::text,
    'inventory_damage'::text, 'operating_expense'::text,
    'operating_expense_payment'::text, 'operating_expense_reversal'::text,
    'operating_expense_refund'::text, 'petty_cash_expense_reversal'::text,
    'inventory_count_adjustment'::text
  ]));

INSERT INTO public.chart_of_accounts
  (code, name, description, account_type, account_subtype, is_system, is_active)
VALUES
  ('4900', 'Inventory Count Variance Gain',
   'Income recognized when an evidenced stock count identifies additional inventory.',
   'revenue', 'other_revenue', true, true)
ON CONFLICT (code) DO NOTHING;

DO $inventory_count_accounts$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
    WHERE code = '4900' AND account_type = 'revenue' AND is_active
  ) THEN
    RAISE EXCEPTION 'Chart of accounts code 4900 must be an active income account';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
    WHERE code = '1200' AND account_type = 'asset' AND is_active
  ) THEN
    RAISE EXCEPTION 'Chart of accounts code 1200 must be an active Inventory asset account';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
    WHERE code = '6500' AND account_type = 'expense' AND is_active
  ) THEN
    RAISE EXCEPTION 'Chart of accounts code 6500 must be an active Inventory Shrinkage expense account';
  END IF;
END;
$inventory_count_accounts$;

CREATE TABLE public.inventory_count_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  counted_on date NOT NULL,
  system_quantity integer NOT NULL CHECK (system_quantity >= 0),
  counted_quantity integer NOT NULL CHECK (counted_quantity >= 0),
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  adjustment_value numeric(14,2) NOT NULL CHECK (adjustment_value > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  reference_number text NOT NULL CHECK (length(btrim(reference_number)) > 0),
  inventory_transaction_id uuid NOT NULL UNIQUE
    REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT,
  journal_entry_id uuid NOT NULL UNIQUE
    REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL UNIQUE,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_count_adjustments_product_date_idx
  ON public.inventory_count_adjustments(product_id, counted_on DESC);

ALTER TABLE public.inventory_count_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_count_adjustments_finance_read
  ON public.inventory_count_adjustments FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'auditor']));
REVOKE ALL ON TABLE public.inventory_count_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.inventory_count_adjustments TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_inventory_count_adjustment_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $inventory_count_immutable$
BEGIN
  RAISE EXCEPTION 'Posted stock-count adjustments are immutable';
END;
$inventory_count_immutable$;

CREATE TRIGGER inventory_count_adjustments_immutable
BEFORE UPDATE OR DELETE ON public.inventory_count_adjustments
FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_count_adjustment_mutations();
REVOKE ALL ON FUNCTION public.guard_inventory_count_adjustment_mutations() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_posted_inventory_transaction_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $posted_inventory_guard_count$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to change inventory records';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE source_id = OLD.id
      AND source_type IN ('stock_purchase', 'inventory_damage', 'inventory_count_adjustment')
  ) OR (
    OLD.reference_type = 'invoice'
    AND EXISTS (
      SELECT 1 FROM public.journal_entries
      WHERE source_type = 'invoice' AND source_id = OLD.reference_id
    )
  ) THEN
    RAISE EXCEPTION 'An inventory transaction with a posted journal is immutable; record an audited reversal instead';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$posted_inventory_guard_count$;

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
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can approve stock-count corrections';
  END IF;
  IF p_product_id IS NULL OR p_counted_quantity IS NULL OR p_counted_quantity < 0
     OR p_counted_on IS NULL OR p_counted_on > CURRENT_DATE
     OR NULLIF(BTRIM(p_reason), '') IS NULL
     OR NULLIF(BTRIM(p_reference_number), '') IS NULL
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Product, non-negative counted quantity, valid count date, reason, reference and idempotency key are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_existing
  FROM public.inventory_count_adjustments
  WHERE idempotency_key = p_idempotency_key
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
  WHERE id = p_product_id AND deleted_at IS NULL
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
  WHERE product_id = p_product_id;
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
  WHERE code = '1200' AND account_type = 'asset' AND is_active LIMIT 1;
  IF v_delta > 0 THEN
    SELECT id INTO v_variance_account
    FROM public.chart_of_accounts
    WHERE code = '4900' AND account_type = 'revenue' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_variance_account
    FROM public.chart_of_accounts
    WHERE code = '6500' AND account_type = 'expense' AND is_active LIMIT 1;
  END IF;
  IF v_inventory_account IS NULL OR v_variance_account IS NULL THEN
    RAISE EXCEPTION 'Inventory or stock-count variance account is not configured';
  END IF;

  PERFORM set_config('app.inventory_adjustment_rpc', 'on', true);
  UPDATE public.products
  SET stock_quantity = p_counted_quantity
  WHERE id = p_product_id;

  INSERT INTO public.inventory_transactions (
    product_id, type, quantity, previous_quantity, new_quantity,
    unit_cost, total_cost, reference_type, reference_number, notes,
    performed_by
  )
  VALUES (
    p_product_id, 'adjustment', abs(v_delta), v_system_quantity,
    p_counted_quantity, v_unit_cost, v_value, 'inventory_count',
    BTRIM(p_reference_number), BTRIM(p_reason), auth.uid()
  )
  RETURNING id INTO v_transaction_id;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  )
  VALUES (
    v_entry_number, p_counted_on,
    'Stock count correction - ' || v_product.name || ' - ' || BTRIM(p_reference_number),
    'inventory_count_adjustment', v_transaction_id, v_currency, auth.uid()
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.inventory_count_adjustments (
    product_id, counted_on, system_quantity, counted_quantity, quantity_delta,
    unit_cost, adjustment_value, reason, reference_number,
    inventory_transaction_id, journal_entry_id, idempotency_key, recorded_by
  )
  VALUES (
    p_product_id, p_counted_on, v_system_quantity, p_counted_quantity, v_delta,
    v_unit_cost, v_value, BTRIM(p_reason), BTRIM(p_reference_number),
    v_transaction_id, v_journal_id, p_idempotency_key, auth.uid()
  )
  RETURNING id INTO v_adjustment_id;

  -- The journal source points at the immutable inventory movement for audit joins.
  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  )
  VALUES
    (v_journal_id, 1, v_inventory_account,
     'Inventory count increase - ' || v_product.name,
     CASE WHEN v_delta > 0 THEN v_value ELSE 0 END,
     CASE WHEN v_delta < 0 THEN v_value ELSE 0 END),
    (v_journal_id, 2, v_variance_account,
     CASE WHEN v_delta > 0 THEN 'Inventory count variance gain - ' || v_product.name
          ELSE 'Inventory count shortage - ' || v_product.name END,
     CASE WHEN v_delta < 0 THEN v_value ELSE 0 END,
     CASE WHEN v_delta > 0 THEN v_value ELSE 0 END);

  RETURN v_adjustment_id;
END;
$record_stock_count$;

REVOKE ALL ON FUNCTION public.record_stock_count_adjustment(uuid, integer, date, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_count_adjustment(uuid, integer, date, text, text, uuid) TO authenticated;
