-- Safe stock-purchase reversals. Historical stock purchases without a
-- trustworthy prior valuation snapshot cannot be reversed automatically.
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS previous_unit_cost numeric(14,4),
  ADD COLUMN IF NOT EXISTS previous_cost_verified boolean NOT NULL DEFAULT false;

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
    'inventory_count_adjustment'::text, 'stock_purchase_reversal'::text
  ]));

CREATE OR REPLACE FUNCTION public.record_stock_purchase(
  p_product_id uuid,
  p_quantity integer,
  p_unit_cost numeric,
  p_supplier_name text DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_amount_paid numeric DEFAULT 0,
  p_payment_method public.payment_method DEFAULT 'cash',
  p_notes text DEFAULT NULL,
  p_opening_unit_cost numeric DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $stock_purchase$
DECLARE
  v_product public.products%ROWTYPE;
  v_existing public.inventory_transactions%ROWTYPE;
  v_transaction_id uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_inventory_account uuid;
  v_cash_account uuid;
  v_payable_account uuid;
  v_equity_account uuid;
  v_opening_journal_id uuid;
  v_opening_entry_number text;
  v_opening_value numeric(14,2) := 0;
  v_currency text;
  v_previous_quantity integer;
  v_previous_unit_cost numeric(14,4);
  v_previous_cost_verified boolean;
  v_new_quantity integer;
  v_total_cost numeric(14,2);
  v_new_average_cost numeric(14,4);
  v_amount_paid numeric(14,2);
  v_line_number integer := 1;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to record stock purchases';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Purchase quantity must be greater than zero';
  END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'A valid actual unit purchase cost is required';
  END IF;
  IF NULLIF(BTRIM(p_reference_number), '') IS NULL THEN
    RAISE EXCEPTION 'A supplier invoice, receipt or purchase reference is required';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required to record a stock purchase';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  SELECT * INTO v_existing
  FROM public.inventory_transactions
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.type <> 'purchase'
      OR v_existing.product_id <> p_product_id
      OR v_existing.quantity <> p_quantity
      OR v_existing.unit_cost IS DISTINCT FROM ROUND(p_unit_cost, 4)
      OR v_existing.reference_number IS DISTINCT FROM BTRIM(p_reference_number)
      OR v_existing.supplier_name IS DISTINCT FROM NULLIF(BTRIM(p_supplier_name), '')
      OR v_existing.amount_paid IS DISTINCT FROM ROUND(COALESCE(p_amount_paid, 0), 2)
      OR v_existing.payment_method IS DISTINCT FROM p_payment_method
      OR v_existing.notes IS DISTINCT FROM NULLIF(BTRIM(p_notes), '')
      OR v_existing.opening_unit_cost IS DISTINCT FROM (CASE WHEN p_opening_unit_cost IS NULL THEN NULL ELSE ROUND(p_opening_unit_cost, 4) END) THEN
      RAISE EXCEPTION 'This stock-purchase idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  v_total_cost := ROUND(p_quantity * p_unit_cost, 2);
  v_amount_paid := ROUND(COALESCE(p_amount_paid, 0), 2);
  IF v_amount_paid < 0 OR v_amount_paid > v_total_cost THEN
    RAISE EXCEPTION 'Amount paid must be between zero and the purchase total';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(v_product.is_service, false) THEN
    RAISE EXCEPTION 'Select an active physical product before recording a stock purchase';
  END IF;

  v_previous_quantity := GREATEST(COALESCE(v_product.stock_quantity, 0), 0);
  v_previous_unit_cost := CASE
    WHEN v_previous_quantity = 0 THEN NULL
    WHEN COALESCE(v_product.cost_price_verified, false) THEN v_product.cost_price
    ELSE p_opening_unit_cost
  END;
  v_previous_cost_verified := v_previous_quantity > 0
    AND (COALESCE(v_product.cost_price_verified, false) OR p_opening_unit_cost IS NOT NULL);
  IF v_previous_quantity > 0 AND NOT COALESCE(v_product.cost_price_verified, false)
     AND (p_opening_unit_cost IS NULL OR p_opening_unit_cost < 0) THEN
    RAISE EXCEPTION 'Enter the actual unit cost of existing opening stock before adding a new purchase.';
  END IF;

  v_new_quantity := v_previous_quantity + p_quantity;
  IF v_previous_quantity = 0 THEN
    v_new_average_cost := ROUND(p_unit_cost, 4);
  ELSIF COALESCE(v_product.cost_price_verified, false) THEN
    v_new_average_cost := ROUND(
      ((v_previous_quantity * COALESCE(v_product.cost_price, 0)) + (p_quantity * p_unit_cost))
      / v_new_quantity, 4
    );
  ELSE
    v_opening_value := ROUND(v_previous_quantity * p_opening_unit_cost, 2);
    v_new_average_cost := ROUND(
      ((v_previous_quantity * p_opening_unit_cost) + (p_quantity * p_unit_cost))
      / v_new_quantity, 4
    );
  END IF;

  PERFORM set_config('app.stock_purchase_rpc', 'on', true);
  UPDATE public.products
  SET stock_quantity = v_new_quantity,
      cost_price = v_new_average_cost,
      cost_price_verified = true
  WHERE id = p_product_id;

  INSERT INTO public.inventory_transactions (
    product_id, type, quantity, previous_quantity, new_quantity,
    unit_cost, total_cost, reference_type, supplier_name,
    reference_number, payment_method, amount_paid, notes, performed_by,
    idempotency_key, opening_unit_cost, previous_unit_cost, previous_cost_verified
  )
  VALUES (
    p_product_id, 'purchase', p_quantity, v_previous_quantity, v_new_quantity,
    ROUND(p_unit_cost, 4), v_total_cost, 'stock_purchase',
    NULLIF(BTRIM(p_supplier_name), ''), NULLIF(BTRIM(p_reference_number), ''),
    p_payment_method, v_amount_paid, NULLIF(BTRIM(p_notes), ''), auth.uid(),
    p_idempotency_key, p_opening_unit_cost, v_previous_unit_cost, v_previous_cost_verified
  )
  RETURNING id INTO v_transaction_id;

  SELECT id INTO v_inventory_account
  FROM public.chart_of_accounts
  WHERE code = '1200' AND account_type = 'asset' AND is_active
  LIMIT 1;
  SELECT id INTO v_equity_account
  FROM public.chart_of_accounts
  WHERE code = '3000' AND account_type = 'equity' AND is_active
  LIMIT 1;
  SELECT id INTO v_payable_account
  FROM public.chart_of_accounts
  WHERE code = '2000' AND account_type = 'liability' AND is_active
  LIMIT 1;

  IF v_inventory_account IS NULL OR v_payable_account IS NULL THEN
    RAISE EXCEPTION 'Inventory or Accounts Payable account is not configured';
  END IF;
  IF v_opening_value > 0 AND v_equity_account IS NULL THEN
    RAISE EXCEPTION 'Owner equity account is not configured for opening stock valuation';
  END IF;

  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  IF v_opening_value > 0 THEN
    v_opening_entry_number := public.get_next_sequence('journal');
    INSERT INTO public.journal_entries (
      entry_number, entry_date, description, source_type, source_id, currency, created_by
    )
    VALUES (
      v_opening_entry_number, CURRENT_DATE,
      'Opening stock valuation - ' || v_product.name,
      'opening_stock_valuation', p_product_id, v_currency, auth.uid()
    )
    RETURNING id INTO v_opening_journal_id;

    INSERT INTO public.journal_lines (
      journal_entry_id, line_number, account_id, description, debit, credit
    )
    VALUES
      (v_opening_journal_id, 1, v_inventory_account, 'Opening inventory - ' || v_product.name, v_opening_value, 0),
      (v_opening_journal_id, 2, v_equity_account, 'Opening stock equity - ' || v_product.name, 0, v_opening_value);
  END IF;

  IF v_amount_paid > 0 THEN
    IF p_payment_method = 'cash' THEN
      SELECT id INTO v_cash_account FROM public.chart_of_accounts
      WHERE code = '1000' AND account_type = 'asset' AND is_active LIMIT 1;
    ELSE
      SELECT id INTO v_cash_account FROM public.chart_of_accounts
      WHERE code = '1010' AND account_type = 'asset' AND is_active LIMIT 1;
    END IF;
    IF v_cash_account IS NULL THEN
      RAISE EXCEPTION 'The selected cash or bank account is not configured';
    END IF;
  END IF;

  v_entry_number := public.get_next_sequence('journal');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  )
  VALUES (
    v_entry_number, CURRENT_DATE,
    'Stock purchase - ' || v_product.name || ' (' || p_quantity || ' ' || COALESCE(v_product.unit, 'units') || ')',
    'stock_purchase', v_transaction_id, v_currency, auth.uid()
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  )
  VALUES (
    v_journal_id, v_line_number, v_inventory_account,
    'Inventory received - ' || v_product.name, v_total_cost, 0
  );
  v_line_number := v_line_number + 1;

  IF v_amount_paid > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id, line_number, account_id, description, debit, credit
    )
    VALUES (
      v_journal_id, v_line_number, v_cash_account,
      'Purchase payment - ' || v_product.name, 0, v_amount_paid
    );
    v_line_number := v_line_number + 1;
  END IF;

  IF v_total_cost - v_amount_paid > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id, line_number, account_id, description, debit, credit
    )
    VALUES (
      v_journal_id, v_line_number, v_payable_account,
      'Supplier balance - ' || v_product.name, 0, v_total_cost - v_amount_paid
    );
  END IF;

  RETURN v_transaction_id;
END;
$stock_purchase$;

REVOKE ALL ON FUNCTION public.record_stock_purchase(uuid, integer, numeric, text, text, numeric, public.payment_method, text, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_purchase(uuid, integer, numeric, text, text, numeric, public.payment_method, text, numeric, uuid) TO authenticated;

CREATE TABLE public.inventory_purchase_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_purchase_transaction_id uuid NOT NULL UNIQUE
    REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT,
  reversal_inventory_transaction_id uuid NOT NULL UNIQUE
    REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT,
  journal_entry_id uuid NOT NULL UNIQUE
    REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  reversed_on date NOT NULL,
  refunded_amount numeric(14,2) NOT NULL CHECK (refunded_amount >= 0),
  refund_payment_method public.payment_method
    CHECK (refund_payment_method IS NULL OR refund_payment_method IN ('cash', 'bank_transfer', 'mobile_payment')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  reference_number text NOT NULL CHECK (length(btrim(reference_number)) > 0),
  idempotency_key uuid NOT NULL UNIQUE,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_purchase_reversals_date_idx
  ON public.inventory_purchase_reversals(reversed_on DESC);

ALTER TABLE public.inventory_purchase_reversals ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_purchase_reversals_finance_read
  ON public.inventory_purchase_reversals FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'auditor']));
REVOKE ALL ON TABLE public.inventory_purchase_reversals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.inventory_purchase_reversals TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_inventory_purchase_reversal_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $purchase_reversal_immutable$
BEGIN
  RAISE EXCEPTION 'Posted stock-purchase reversals are immutable';
END;
$purchase_reversal_immutable$;

CREATE TRIGGER inventory_purchase_reversals_immutable
BEFORE UPDATE OR DELETE ON public.inventory_purchase_reversals
FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_purchase_reversal_mutations();
REVOKE ALL ON FUNCTION public.guard_inventory_purchase_reversal_mutations() FROM PUBLIC, anon, authenticated;

-- Extend the existing inventory transaction guard to cover the reversal movement.
CREATE OR REPLACE FUNCTION public.guard_posted_inventory_transaction_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $posted_inventory_guard_reversal$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to change inventory records';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE source_id = OLD.id
      AND source_type IN (
        'stock_purchase', 'inventory_damage',
        'inventory_count_adjustment', 'stock_purchase_reversal'
      )
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
$posted_inventory_guard_reversal$;

CREATE OR REPLACE FUNCTION public.reverse_stock_purchase(
  p_purchase_transaction_id uuid,
  p_reversed_on date,
  p_refund_payment_method public.payment_method,
  p_reason text,
  p_reference_number text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reverse_stock_purchase$
DECLARE
  v_purchase public.inventory_transactions%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_existing public.inventory_purchase_reversals%ROWTYPE;
  v_purchase_journal public.journal_entries%ROWTYPE;
  v_reversal_id uuid;
  v_reversal_transaction_id uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_inventory_account uuid;
  v_payable_account uuid;
  v_refund_account uuid;
  v_currency text;
  v_paid numeric(14,2);
  v_unpaid numeric(14,2);
  v_total numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can reverse stock purchases';
  END IF;
  IF p_purchase_transaction_id IS NULL OR p_reversed_on IS NULL
     OR p_reversed_on > CURRENT_DATE
     OR NULLIF(BTRIM(p_reason), '') IS NULL
     OR NULLIF(BTRIM(p_reference_number), '') IS NULL
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Purchase, valid reversal date, reason, reference and idempotency key are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_existing
  FROM public.inventory_purchase_reversals
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.original_purchase_transaction_id <> p_purchase_transaction_id
       OR v_existing.reversed_on <> p_reversed_on
       OR v_existing.refund_payment_method IS DISTINCT FROM p_refund_payment_method
       OR v_existing.reason <> BTRIM(p_reason)
       OR v_existing.reference_number <> BTRIM(p_reference_number) THEN
      RAISE EXCEPTION 'This stock-purchase reversal idempotency key was used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_purchase
  FROM public.inventory_transactions
  WHERE id = p_purchase_transaction_id AND type = 'purchase'
    AND reference_type = 'stock_purchase'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The original stock-purchase transaction was not found';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = v_purchase.product_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_product.is_service, false) THEN
    RAISE EXCEPTION 'The original physical inventory product is no longer available';
  END IF;

  SELECT * INTO v_purchase_journal
  FROM public.journal_entries
  WHERE source_type = 'stock_purchase' AND source_id = v_purchase.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The original stock purchase has no posted journal entry';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_purchase_reversals
    WHERE original_purchase_transaction_id = v_purchase.id
  ) THEN
    RAISE EXCEPTION 'This stock purchase has already been reversed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_transactions later
    WHERE later.product_id = v_purchase.product_id
      AND later.id <> v_purchase.id
      AND (later.created_at, later.id) > (v_purchase.created_at, v_purchase.id)
  ) THEN
    RAISE EXCEPTION 'This purchase cannot be reversed because later inventory movements exist; historical weighted-average costing must not be rewritten';
  END IF;

  IF COALESCE(v_product.stock_quantity, 0) <> COALESCE(v_purchase.new_quantity, -1) THEN
    RAISE EXCEPTION 'Current stock no longer matches the original purchase closing quantity';
  END IF;

  IF v_purchase.previous_quantity > 0
     AND (v_purchase.previous_unit_cost IS NULL OR NOT v_purchase.previous_cost_verified) THEN
    RAISE EXCEPTION 'This historical purchase has no verified prior-cost snapshot and cannot be safely reversed';
  END IF;

  IF NOT COALESCE(v_product.cost_price_verified, false) THEN
    RAISE EXCEPTION 'Current inventory valuation is no longer verified; reconcile its cost before reversal';
  END IF;

  IF p_reversed_on < v_purchase_journal.entry_date THEN
    RAISE EXCEPTION 'Reversal date cannot predate the original stock-purchase journal';
  END IF;

  v_total := ROUND(COALESCE(v_purchase.total_cost, 0), 2);
  v_paid := ROUND(COALESCE(v_purchase.amount_paid, 0), 2);
  v_unpaid := v_total - v_paid;
  IF v_total <= 0 OR v_paid < 0 OR v_unpaid < 0 THEN
    RAISE EXCEPTION 'Original purchase values are invalid; reversal is blocked';
  END IF;
  IF v_paid > 0 AND p_refund_payment_method NOT IN ('cash', 'bank_transfer', 'mobile_payment') THEN
    RAISE EXCEPTION 'Record the actual supplier refund method for the amount previously paid';
  END IF;
  IF v_paid = 0 AND p_refund_payment_method IS NOT NULL THEN
    RAISE EXCEPTION 'No cash refund method is required for a fully unpaid purchase';
  END IF;

  IF ABS((
    SELECT COALESCE(SUM(debit - credit), 0)
    FROM public.journal_lines
    WHERE journal_entry_id = v_purchase_journal.id
  )) > 0.01 THEN
    RAISE EXCEPTION 'Original stock-purchase journal is not balanced';
  END IF;

  SELECT id INTO v_inventory_account
  FROM public.chart_of_accounts
  WHERE code = '1200' AND account_type = 'asset' AND is_active LIMIT 1;
  SELECT id INTO v_payable_account
  FROM public.chart_of_accounts
  WHERE code = '2000' AND account_type = 'liability' AND is_active LIMIT 1;
  IF v_paid > 0 THEN
    IF p_refund_payment_method = 'cash' THEN
      SELECT id INTO v_refund_account FROM public.chart_of_accounts
      WHERE code = '1000' AND account_type = 'asset' AND is_active LIMIT 1;
    ELSE
      SELECT id INTO v_refund_account FROM public.chart_of_accounts
      WHERE code = '1010' AND account_type = 'asset' AND is_active LIMIT 1;
    END IF;
  END IF;
  IF v_inventory_account IS NULL OR v_payable_account IS NULL
     OR (v_paid > 0 AND v_refund_account IS NULL) THEN
    RAISE EXCEPTION 'Inventory, Accounts Payable or selected refund account is not configured';
  END IF;

  PERFORM set_config('app.stock_purchase_rpc', 'on', true);
  UPDATE public.products
  SET stock_quantity = v_purchase.previous_quantity,
      cost_price = CASE
        WHEN v_purchase.previous_quantity > 0 THEN v_purchase.previous_unit_cost
        ELSE NULL
      END,
      cost_price_verified = CASE
        WHEN v_purchase.previous_quantity > 0 THEN v_purchase.previous_cost_verified
        ELSE false
      END
  WHERE id = v_product.id;

  INSERT INTO public.inventory_transactions (
    product_id, type, quantity, previous_quantity, new_quantity,
    unit_cost, total_cost, reference_id, reference_type,
    reference_number, supplier_name, notes, performed_by, idempotency_key
  )
  VALUES (
    v_purchase.product_id, 'return', v_purchase.quantity,
    v_purchase.new_quantity, v_purchase.previous_quantity,
    v_purchase.unit_cost, v_total, v_purchase.id, 'stock_purchase_reversal',
    BTRIM(p_reference_number), v_purchase.supplier_name,
    BTRIM(p_reason), auth.uid(), p_idempotency_key
  )
  RETURNING id INTO v_reversal_transaction_id;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  )
  VALUES (
    v_entry_number, p_reversed_on,
    'Stock purchase reversal - ' || COALESCE(v_purchase.supplier_name, 'supplier')
      || ' - ' || BTRIM(p_reference_number),
    'stock_purchase_reversal', v_reversal_transaction_id, v_currency, auth.uid()
  )
  RETURNING id INTO v_journal_id;

  IF v_paid > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id, line_number, account_id, description, debit, credit
    )
    VALUES (
      v_journal_id, 1, v_refund_account,
      'Supplier refund received - ' || BTRIM(p_reference_number), v_paid, 0
    );
  END IF;
  IF v_unpaid > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id, line_number, account_id, description, debit, credit
    )
    VALUES (
      v_journal_id, CASE WHEN v_paid > 0 THEN 2 ELSE 1 END,
      v_payable_account, 'Reverse unpaid supplier balance', v_unpaid, 0
    );
  END IF;
  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  )
  VALUES (
    v_journal_id, CASE WHEN v_unpaid > 0 THEN 3 WHEN v_paid > 0 THEN 2 ELSE 1 END,
    v_inventory_account, 'Return inventory to supplier', 0, v_total
  );

  INSERT INTO public.inventory_purchase_reversals (
    original_purchase_transaction_id, reversal_inventory_transaction_id,
    journal_entry_id, reversed_on, refunded_amount, refund_payment_method,
    reason, reference_number, idempotency_key, recorded_by
  )
  VALUES (
    v_purchase.id, v_reversal_transaction_id, v_journal_id,
    p_reversed_on, v_paid, p_refund_payment_method,
    BTRIM(p_reason), BTRIM(p_reference_number), p_idempotency_key, auth.uid()
  )
  RETURNING id INTO v_reversal_id;

  RETURN v_reversal_id;
END;
$reverse_stock_purchase$;

REVOKE ALL ON FUNCTION public.reverse_stock_purchase(uuid, date, public.payment_method, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_stock_purchase(uuid, date, public.payment_method, text, text, uuid) TO authenticated;
