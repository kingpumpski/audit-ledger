-- Verified stock purchase costs, invoice-level cost snapshots and expense postings.
-- This migration deliberately leaves historical costs unknown when no purchase evidence exists.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_price_verified boolean NOT NULL DEFAULT false;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS unit_cost numeric(14,4),
  ADD COLUMN IF NOT EXISTS cost_source text;

ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS supplier_name text,
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS payment_method public.payment_method,
  ADD COLUMN IF NOT EXISTS amount_paid numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.petty_cash_transactions
  ADD COLUMN IF NOT EXISTS payment_method public.payment_method NOT NULL DEFAULT 'cash';

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'invoice'::text, 'payment'::text, 'receipt'::text, 'receipt_void'::text,
    'stock_purchase'::text, 'petty_cash_expense'::text
  ]));

ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT inventory_transactions_amount_paid_check
  CHECK (amount_paid >= 0);

ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT inventory_transactions_purchase_payment_check
  CHECK (type <> 'purchase' OR amount_paid <= COALESCE(total_cost, 0));

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_reference
  ON public.inventory_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source_type_date
  ON public.journal_entries(source_type, entry_date);

-- A manually edited cost is no longer considered purchase-verified.
CREATE OR REPLACE FUNCTION public.invalidate_product_cost_verification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $cost_guard$
BEGIN
  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price
     AND COALESCE(current_setting('app.stock_purchase_rpc', true), '') <> 'on' THEN
    NEW.cost_price_verified := false;
  END IF;
  RETURN NEW;
END;
$cost_guard$;

CREATE TRIGGER invalidate_product_cost_verification
BEFORE UPDATE OF cost_price ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_product_cost_verification();

-- Snapshot the verified weighted-average purchase cost when an invoice line is saved.
-- A later product-cost change can never rewrite the cost of an earlier sale.
CREATE OR REPLACE FUNCTION public.snapshot_invoice_item_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $snapshot_cost$
DECLARE
  v_cost numeric(14,4);
  v_verified boolean;
BEGIN
  IF NEW.product_id IS NULL THEN
    NEW.unit_cost := NULL;
    NEW.cost_source := NULL;
    RETURN NEW;
  END IF;

  SELECT cost_price, cost_price_verified
    INTO v_cost, v_verified
  FROM public.products
  WHERE id = NEW.product_id
    AND deleted_at IS NULL;

  IF COALESCE(v_verified, false) AND v_cost IS NOT NULL AND v_cost >= 0 THEN
    NEW.unit_cost := v_cost;
    NEW.cost_source := 'verified_weighted_average';
  ELSE
    NEW.unit_cost := NULL;
    NEW.cost_source := NULL;
  END IF;

  RETURN NEW;
END;
$snapshot_cost$;

CREATE TRIGGER snapshot_invoice_item_cost
BEFORE INSERT OR UPDATE OF product_id, quantity ON public.invoice_items
FOR EACH ROW
EXECUTE FUNCTION public.snapshot_invoice_item_cost();

-- A stock purchase is one atomic operation: inventory quantity/value, weighted
-- average cost, purchase audit row, cash/AP and the journal all commit together.
CREATE OR REPLACE FUNCTION public.record_stock_purchase(
  p_product_id uuid,
  p_quantity integer,
  p_unit_cost numeric,
  p_supplier_name text DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_amount_paid numeric DEFAULT 0,
  p_payment_method public.payment_method DEFAULT 'cash',
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $stock_purchase$
DECLARE
  v_product public.products%ROWTYPE;
  v_transaction_id uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_inventory_account uuid;
  v_cash_account uuid;
  v_payable_account uuid;
  v_currency text;
  v_previous_quantity integer;
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
  IF v_previous_quantity > 0 AND NOT COALESCE(v_product.cost_price_verified, false) THEN
    RAISE EXCEPTION 'Existing stock has no verified cost. Record its opening stock value before adding a purchase.';
  END IF;

  v_new_quantity := v_previous_quantity + p_quantity;
  IF v_previous_quantity = 0 THEN
    v_new_average_cost := ROUND(p_unit_cost, 4);
  ELSE
    v_new_average_cost := ROUND(
      ((v_previous_quantity * COALESCE(v_product.cost_price, 0)) + (p_quantity * p_unit_cost))
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
    reference_number, payment_method, amount_paid, notes, performed_by
  )
  VALUES (
    p_product_id, 'purchase', p_quantity, v_previous_quantity, v_new_quantity,
    ROUND(p_unit_cost, 4), v_total_cost, 'stock_purchase',
    NULLIF(BTRIM(p_supplier_name), ''), NULLIF(BTRIM(p_reference_number), ''),
    p_payment_method, v_amount_paid, NULLIF(BTRIM(p_notes), ''), auth.uid()
  )
  RETURNING id INTO v_transaction_id;

  SELECT id INTO v_inventory_account
  FROM public.chart_of_accounts
  WHERE code = '1200' AND account_type = 'asset' AND is_active
  LIMIT 1;
  SELECT id INTO v_payable_account
  FROM public.chart_of_accounts
  WHERE code = '2000' AND account_type = 'liability' AND is_active
  LIMIT 1;

  IF v_inventory_account IS NULL OR v_payable_account IS NULL THEN
    RAISE EXCEPTION 'Inventory or Accounts Payable account is not configured';
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
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

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

REVOKE ALL ON FUNCTION public.record_stock_purchase(uuid, integer, numeric, text, text, numeric, public.payment_method, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_purchase(uuid, integer, numeric, text, text, numeric, public.payment_method, text) TO authenticated;

-- Attach cost of sales to the same balanced journal as the invoice revenue.
-- No COGS is posted unless every invoice line has a verified cost snapshot.
CREATE OR REPLACE FUNCTION public.post_invoice_cogs_after_receivable_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $invoice_cogs$
DECLARE
  v_invoice_id uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_cogs_total numeric(14,2);
BEGIN
  IF NEW.line_number <> 1 THEN
    RETURN NEW;
  END IF;

  SELECT source_id INTO v_invoice_id
  FROM public.journal_entries
  WHERE id = NEW.journal_entry_id AND source_type = 'invoice';

  IF v_invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoice_items
    WHERE invoice_id = v_invoice_id AND unit_cost IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  SELECT ROUND(COALESCE(SUM(quantity * unit_cost), 0), 2)
    INTO v_cogs_total
  FROM public.invoice_items
  WHERE invoice_id = v_invoice_id;

  IF v_cogs_total <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_cogs_account FROM public.chart_of_accounts
  WHERE code = '5000' AND account_type = 'expense' AND is_active LIMIT 1;
  SELECT id INTO v_inventory_account FROM public.chart_of_accounts
  WHERE code = '1200' AND account_type = 'asset' AND is_active LIMIT 1;

  IF v_cogs_account IS NULL OR v_inventory_account IS NULL THEN
    RAISE EXCEPTION 'Cost of Goods Sold or Inventory account is not configured';
  END IF;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  )
  VALUES
    (NEW.journal_entry_id, 9998, v_cogs_account, 'Cost of goods sold - invoice ' || v_invoice_id, v_cogs_total, 0),
    (NEW.journal_entry_id, 9999, v_inventory_account, 'Inventory relieved - invoice ' || v_invoice_id, 0, v_cogs_total);

  RETURN NEW;
END;
$invoice_cogs$;

CREATE TRIGGER post_invoice_cogs_after_receivable_line
AFTER INSERT ON public.journal_lines
FOR EACH ROW
WHEN (NEW.line_number = 1)
EXECUTE FUNCTION public.post_invoice_cogs_after_receivable_line();

REVOKE ALL ON FUNCTION public.post_invoice_cogs_after_receivable_line() FROM PUBLIC, anon, authenticated;

-- Every petty-cash expense is posted immediately. Income rows are deliberately
-- not reclassified as sales revenue; they need a separate source/account mapping.
CREATE OR REPLACE FUNCTION public.post_petty_cash_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $petty_expense$
DECLARE
  v_expense_account uuid;
  v_cash_account uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_currency text;
  v_account_code text;
BEGIN
  IF NEW.type <> 'expense' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'You are not authorized to post petty cash expenses';
  END IF;

  v_account_code := CASE
    WHEN lower(COALESCE(NEW.category, '')) ~ '(salary|wage|payroll)' THEN '6100'
    WHEN lower(COALESCE(NEW.category, '')) ~ '(rent|lease)' THEN '6200'
    WHEN lower(COALESCE(NEW.category, '')) ~ '(utility|electric|water|internet)' THEN '6300'
    ELSE '6000'
  END;

  SELECT id INTO v_expense_account FROM public.chart_of_accounts
  WHERE code = v_account_code AND account_type = 'expense' AND is_active LIMIT 1;

  IF NEW.payment_method = 'cash' THEN
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE code = '1000' AND account_type = 'asset' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE code = '1010' AND account_type = 'asset' AND is_active LIMIT 1;
  END IF;

  IF v_expense_account IS NULL OR v_cash_account IS NULL THEN
    RAISE EXCEPTION 'The expense or payment account is not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  )
  VALUES (
    v_entry_number, NEW.date, 'Expense - ' || NEW.description,
    'petty_cash_expense', NEW.id, v_currency, COALESCE(NEW.recorded_by, auth.uid())
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  )
  VALUES
    (v_journal_id, 1, v_expense_account, NEW.description, ROUND(NEW.amount, 2), 0),
    (v_journal_id, 2, v_cash_account, 'Cash/bank paid - ' || NEW.description, 0, ROUND(NEW.amount, 2));

  RETURN NEW;
END;
$petty_expense$;

CREATE TRIGGER post_petty_cash_expense_after_insert
AFTER INSERT ON public.petty_cash_transactions
FOR EACH ROW
EXECUTE FUNCTION public.post_petty_cash_expense();

REVOKE ALL ON FUNCTION public.post_petty_cash_expense() FROM PUBLIC, anon, authenticated;

-- Backfill legacy petty cash expenses exactly once. Existing records are retained.
DO $petty_cash_backfill$
DECLARE
  v_expense record;
  v_expense_account uuid;
  v_cash_account uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_currency text;
  v_account_code text;
BEGIN
  FOR v_expense IN
    SELECT p.*
    FROM public.petty_cash_transactions p
    WHERE p.type = 'expense'
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries j
        WHERE j.source_type = 'petty_cash_expense' AND j.source_id = p.id
      )
    ORDER BY p.date, p.created_at, p.id
  LOOP
    v_account_code := CASE
      WHEN lower(COALESCE(v_expense.category, '')) ~ '(salary|wage|payroll)' THEN '6100'
      WHEN lower(COALESCE(v_expense.category, '')) ~ '(rent|lease)' THEN '6200'
      WHEN lower(COALESCE(v_expense.category, '')) ~ '(utility|electric|water|internet)' THEN '6300'
      ELSE '6000'
    END;
    SELECT id INTO v_expense_account FROM public.chart_of_accounts
    WHERE code = v_account_code AND account_type = 'expense' AND is_active LIMIT 1;
    IF v_expense.payment_method = 'cash' THEN
      SELECT id INTO v_cash_account FROM public.chart_of_accounts
      WHERE code = '1000' AND account_type = 'asset' AND is_active LIMIT 1;
    ELSE
      SELECT id INTO v_cash_account FROM public.chart_of_accounts
      WHERE code = '1010' AND account_type = 'asset' AND is_active LIMIT 1;
    END IF;
    IF v_expense_account IS NULL OR v_cash_account IS NULL THEN
      RAISE EXCEPTION 'Required accounts are missing while backfilling petty cash expense %', v_expense.id;
    END IF;
    v_entry_number := public.get_next_sequence('journal');
    SELECT COALESCE(currency_code, 'USD') INTO v_currency
    FROM public.company_settings ORDER BY created_at LIMIT 1;
    v_currency := COALESCE(v_currency, 'USD');
    INSERT INTO public.journal_entries (
      entry_number, entry_date, description, source_type, source_id, currency, created_by
    )
    VALUES (
      v_entry_number, v_expense.date, 'Expense - ' || v_expense.description,
      'petty_cash_expense', v_expense.id, v_currency, v_expense.recorded_by
    )
    RETURNING id INTO v_journal_id;
    INSERT INTO public.journal_lines (
      journal_entry_id, line_number, account_id, description, debit, credit
    )
    VALUES
      (v_journal_id, 1, v_expense_account, v_expense.description, ROUND(v_expense.amount, 2), 0),
      (v_journal_id, 2, v_cash_account, 'Cash/bank paid - ' || v_expense.description, 0, ROUND(v_expense.amount, 2));
  END LOOP;
END;
$petty_cash_backfill$;

-- Expose purchase and expense updates to the same live ledger channel.
DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_transactions;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.petty_cash_transactions;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$publication$;

NOTIFY pgrst, 'reload schema';
