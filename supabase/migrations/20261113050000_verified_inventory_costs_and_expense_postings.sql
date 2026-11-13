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
  ADD COLUMN IF NOT EXISTS amount_paid numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS opening_unit_cost numeric(14,4);

ALTER TABLE public.petty_cash_transactions
  ADD COLUMN IF NOT EXISTS payment_method public.payment_method NOT NULL DEFAULT 'cash';

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'invoice'::text, 'payment'::text, 'receipt'::text, 'receipt_void'::text,
    'stock_purchase'::text, 'opening_stock_valuation'::text, 'petty_cash_expense'::text
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

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS cost_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS cost_reference text,
  ADD COLUMN IF NOT EXISTS cost_notes text;

-- Prevent direct client edits to the historical cost snapshot. The audited RPC
-- below is the only route for correcting costs on already-issued invoices.
CREATE OR REPLACE FUNCTION public.guard_invoice_item_cost_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $cost_change_guard$
BEGIN
  IF (NEW.unit_cost IS DISTINCT FROM OLD.unit_cost
      OR NEW.cost_source IS DISTINCT FROM OLD.cost_source
      OR NEW.cost_reference IS DISTINCT FROM OLD.cost_reference
      OR NEW.cost_notes IS DISTINCT FROM OLD.cost_notes
      OR NEW.cost_verified_by IS DISTINCT FROM OLD.cost_verified_by
      OR NEW.cost_verified_at IS DISTINCT FROM OLD.cost_verified_at)
     AND COALESCE(current_setting('app.historical_cost_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Historical item costs must be updated through the audited cost verification action';
  END IF;
  RETURN NEW;
END;
$cost_change_guard$;

CREATE TRIGGER guard_invoice_item_cost_changes
BEFORE UPDATE OF unit_cost, cost_source, cost_reference, cost_notes, cost_verified_by, cost_verified_at
ON public.invoice_items
FOR EACH ROW
EXECUTE FUNCTION public.guard_invoice_item_cost_changes();

-- Once an invoice is issued, its quantity/product basis and cost snapshot are
-- historical accounting evidence. Corrections must be issued as a credit note
-- or reversal, never by silently changing the original invoice lines.
CREATE OR REPLACE FUNCTION public.guard_issued_invoice_item_mutations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $issued_invoice_item_guard$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.invoices
  WHERE id = OLD.invoice_id;

  IF v_status IN ('issued', 'partially_paid', 'paid', 'overdue')
     AND (NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.quantity IS DISTINCT FROM OLD.quantity
       OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
       OR NEW.description IS DISTINCT FROM OLD.description) THEN
    RAISE EXCEPTION 'Issued invoice lines are immutable; use a credit note or audited correction';
  END IF;
  RETURN NEW;
END;
$issued_invoice_item_guard$;

CREATE TRIGGER guard_issued_invoice_item_mutations
BEFORE UPDATE OF product_id, quantity, unit_price, description
ON public.invoice_items
FOR EACH ROW
EXECUTE FUNCTION public.guard_issued_invoice_item_mutations();

CREATE OR REPLACE FUNCTION public.set_historical_invoice_item_cost(
  p_invoice_item_id uuid,
  p_unit_cost numeric,
  p_reference text,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $historical_cost$
DECLARE
  v_item public.invoice_items%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_journal_id uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_cogs_total numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can verify historical product costs';
  END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'Enter a valid historical unit cost';
  END IF;
  IF NULLIF(BTRIM(p_reference), '') IS NULL THEN
    RAISE EXCEPTION 'A supplier invoice, receipt or other source reference is required';
  END IF;

  SELECT * INTO v_item
  FROM public.invoice_items
  WHERE id = p_invoice_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice line was not found';
  END IF;

  IF v_item.product_id IS NULL OR EXISTS (
    SELECT 1 FROM public.products
    WHERE id = v_item.product_id AND is_service = true
  ) THEN
    RAISE EXCEPTION 'Service and manual invoice lines require a separate evidenced direct-cost workflow; they cannot be credited against inventory';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_item.invoice_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_invoice.status NOT IN ('issued', 'partially_paid', 'paid', 'overdue') THEN
    RAISE EXCEPTION 'Historical cost verification is available only for issued invoices';
  END IF;

  SELECT id INTO v_journal_id
  FROM public.journal_entries
  WHERE source_type = 'invoice' AND source_id = v_invoice.id;
  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'The invoice has no posted journal entry to receive its cost-of-sales posting';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_lines jl
    JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
    WHERE jl.journal_entry_id = v_journal_id AND coa.code = '5000'
  ) THEN
    RAISE EXCEPTION 'Cost of goods sold is already posted for this invoice; reverse and repost through a controlled correction';
  END IF;

  PERFORM set_config('app.historical_cost_rpc', 'on', true);
  UPDATE public.invoice_items
  SET unit_cost = ROUND(p_unit_cost, 4),
      cost_source = 'historical_verified',
      cost_verified_by = auth.uid(),
      cost_verified_at = now(),
      cost_reference = NULLIF(BTRIM(p_reference), ''),
      cost_notes = NULLIF(BTRIM(p_notes), '')
  WHERE id = p_invoice_item_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.invoice_items
    WHERE invoice_id = v_invoice.id AND unit_cost IS NULL
  ) THEN
    SELECT ROUND(COALESCE(SUM(quantity * unit_cost), 0), 2)
      INTO v_cogs_total
    FROM public.invoice_items
    WHERE invoice_id = v_invoice.id;

    IF v_cogs_total > 0 THEN
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
        (v_journal_id, 9998, v_cogs_account, 'Verified historical cost of goods sold - ' || v_invoice.invoice_number, v_cogs_total, 0),
        (v_journal_id, 9999, v_inventory_account, 'Verified historical inventory relief - ' || v_invoice.invoice_number, 0, v_cogs_total);
    END IF;
  END IF;

  RETURN p_invoice_item_id;
END;
$historical_cost$;

REVOKE ALL ON FUNCTION public.snapshot_invoice_item_cost() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_invoice_item_cost_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_historical_invoice_item_cost(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_historical_invoice_item_cost(uuid, numeric, text, text) TO authenticated;

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
    idempotency_key, opening_unit_cost
  )
  VALUES (
    p_product_id, 'purchase', p_quantity, v_previous_quantity, v_new_quantity,
    ROUND(p_unit_cost, 4), v_total_cost, 'stock_purchase',
    NULLIF(BTRIM(p_supplier_name), ''), NULLIF(BTRIM(p_reference_number), ''),
    p_payment_method, v_amount_paid, NULLIF(BTRIM(p_notes), ''), auth.uid(),
    p_idempotency_key, p_opening_unit_cost
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

  -- Make the posting idempotent if an invoice journal is repaired or replayed.
  IF EXISTS (
    SELECT 1
    FROM public.journal_lines jl
    JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
    WHERE jl.journal_entry_id = NEW.journal_entry_id
      AND coa.code = '5000'
  ) THEN
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

-- Protect posted source documents from direct edits or deletion. Their journal
-- entries are immutable; corrections must use an audited reversal/repost path.
CREATE OR REPLACE FUNCTION public.guard_posted_inventory_transaction_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $posted_inventory_guard$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to change inventory records';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_entries
    WHERE source_type = 'stock_purchase'
      AND source_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'A stock purchase with a posted journal is immutable; record an audited reversal instead';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$posted_inventory_guard$;

CREATE TRIGGER guard_posted_inventory_transaction_mutations
BEFORE UPDATE OR DELETE ON public.inventory_transactions
FOR EACH ROW
EXECUTE FUNCTION public.guard_posted_inventory_transaction_mutations();

CREATE OR REPLACE FUNCTION public.guard_posted_petty_cash_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $posted_petty_cash_guard$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to change petty-cash records';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.type = 'expense' AND EXISTS (
      SELECT 1
      FROM public.journal_entries
      WHERE source_type = 'petty_cash_expense'
        AND source_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'An expense with a posted journal is immutable; record an audited reversal instead';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION 'A petty-cash record cannot be reclassified between income and expense; use a controlled correction';
  END IF;

  IF OLD.type = 'expense' AND EXISTS (
    SELECT 1
    FROM public.journal_entries
    WHERE source_type = 'petty_cash_expense'
      AND source_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'An expense with a posted journal is immutable; record an audited reversal instead';
  END IF;
  RETURN NEW;
END;
$posted_petty_cash_guard$;

CREATE TRIGGER guard_posted_petty_cash_mutations
BEFORE UPDATE OR DELETE ON public.petty_cash_transactions
FOR EACH ROW
EXECUTE FUNCTION public.guard_posted_petty_cash_mutations();

REVOKE ALL ON FUNCTION public.guard_posted_inventory_transaction_mutations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_posted_petty_cash_mutations() FROM PUBLIC, anon, authenticated;


-- Enforce inventory integrity at the database boundary. Product quantity changes
-- are permitted only inside the audited purchase or invoice-posting routines.
CREATE OR REPLACE FUNCTION public.guard_product_inventory_value_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $product_inventory_guard$
BEGIN
  IF (NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity
      OR NEW.cost_price IS DISTINCT FROM OLD.cost_price
      OR NEW.cost_price_verified IS DISTINCT FROM OLD.cost_price_verified)
     AND COALESCE(current_setting('app.stock_purchase_rpc', true), '') <> 'on'
     AND COALESCE(current_setting('app.invoice_stock_posting', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Stock quantity and verified inventory valuation can only be changed by audited purchase or invoice posting workflows';
  END IF;
  RETURN NEW;
END;
$product_inventory_guard$;

CREATE TRIGGER guard_product_inventory_value_changes
BEFORE UPDATE OF stock_quantity, cost_price, cost_price_verified ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.guard_product_inventory_value_changes();

-- Allow the controlled invoice-issue routine to snapshot the verified cost
-- without opening a direct client-side path to historical cost edits.
CREATE OR REPLACE FUNCTION public.guard_invoice_item_cost_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $cost_change_guard$
BEGIN
  IF (NEW.unit_cost IS DISTINCT FROM OLD.unit_cost
      OR NEW.cost_source IS DISTINCT FROM OLD.cost_source
      OR NEW.cost_reference IS DISTINCT FROM OLD.cost_reference
      OR NEW.cost_notes IS DISTINCT FROM OLD.cost_notes
      OR NEW.cost_verified_by IS DISTINCT FROM OLD.cost_verified_by
      OR NEW.cost_verified_at IS DISTINCT FROM OLD.cost_verified_at)
     AND COALESCE(current_setting('app.historical_cost_rpc', true), '') <> 'on'
     AND COALESCE(current_setting('app.invoice_stock_posting', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Historical item costs must be updated through an audited cost verification or invoice issue action';
  END IF;
  RETURN NEW;
END;
$cost_change_guard$;

-- Validate available stock and take a final verified cost snapshot atomically
-- when an invoice is issued. A missing verified cost is retained as NULL so
-- the P&L correctly withholds profit rather than inventing a cost.
CREATE OR REPLACE FUNCTION public.prepare_invoice_stock_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $prepare_invoice_stock$
DECLARE
  v_line record;
  v_product public.products%ROWTYPE;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'issued' THEN
    PERFORM set_config('app.invoice_stock_posting', 'on', true);

    FOR v_line IN
      SELECT product_id, SUM(quantity) AS quantity
      FROM public.invoice_items
      WHERE invoice_id = NEW.id AND product_id IS NOT NULL
      GROUP BY product_id
      ORDER BY product_id
    LOOP
      SELECT * INTO v_product
      FROM public.products
      WHERE id = v_line.product_id AND deleted_at IS NULL
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'An invoice contains a product that no longer exists';
      END IF;

      IF COALESCE(v_product.is_service, false) THEN
        CONTINUE;
      END IF;

      IF v_line.quantity <= 0 OR v_line.quantity <> trunc(v_line.quantity) THEN
        RAISE EXCEPTION 'Stocked product quantities must be positive whole units';
      END IF;

      IF COALESCE(v_product.stock_quantity, 0) < v_line.quantity THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available: %, requested: %',
          v_product.name, COALESCE(v_product.stock_quantity, 0), v_line.quantity;
      END IF;

      UPDATE public.invoice_items ii
      SET unit_cost = CASE
            WHEN COALESCE(v_product.cost_price_verified, false) THEN v_product.cost_price
            ELSE NULL
          END,
          cost_source = CASE
            WHEN COALESCE(v_product.cost_price_verified, false) THEN 'verified_weighted_average'
            ELSE NULL
          END
      WHERE ii.invoice_id = NEW.id
        AND ii.product_id = v_product.id
        AND (ii.unit_cost IS DISTINCT FROM CASE
              WHEN COALESCE(v_product.cost_price_verified, false) THEN v_product.cost_price
              ELSE NULL
            END
          OR ii.cost_source IS DISTINCT FROM CASE
              WHEN COALESCE(v_product.cost_price_verified, false) THEN 'verified_weighted_average'
              ELSE NULL
            END);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$prepare_invoice_stock$;

CREATE TRIGGER prepare_invoice_stock_issue
BEFORE UPDATE OF status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.prepare_invoice_stock_issue();

-- Reduce inventory once, when the invoice's receivable journal is created.
-- This is the only supported stock-sale path; COGS is added by the existing
-- journal-line trigger using the same invoice-item cost snapshots.
CREATE OR REPLACE FUNCTION public.post_invoice_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $invoice_inventory_posting$
DECLARE
  v_line record;
  v_product public.products%ROWTYPE;
  v_new_quantity integer;
BEGIN
  IF NEW.source_type <> 'invoice' OR NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_transactions
    WHERE reference_type = 'invoice'
      AND reference_id = NEW.source_id
      AND type = 'sale'
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.invoice_stock_posting', 'on', true);

  FOR v_line IN
    SELECT product_id, SUM(quantity) AS quantity,
           CASE WHEN bool_and(unit_cost IS NOT NULL)
             THEN ROUND(SUM(quantity * unit_cost) / NULLIF(SUM(quantity), 0), 4)
             ELSE NULL
           END AS unit_cost,
           CASE WHEN bool_and(unit_cost IS NOT NULL)
             THEN ROUND(SUM(quantity * unit_cost), 2)
             ELSE NULL
           END AS total_cost
    FROM public.invoice_items
    WHERE invoice_id = NEW.source_id AND product_id IS NOT NULL
    GROUP BY product_id
    ORDER BY product_id
  LOOP
    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_line.product_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND OR COALESCE(v_product.is_service, false) THEN
      CONTINUE;
    END IF;

    IF v_line.quantity <= 0 OR v_line.quantity <> trunc(v_line.quantity)
       OR COALESCE(v_product.stock_quantity, 0) < v_line.quantity THEN
      RAISE EXCEPTION 'Invoice inventory movement failed for product %; stock changed after issue validation', v_line.product_id;
    END IF;

    v_new_quantity := v_product.stock_quantity - v_line.quantity::integer;
    UPDATE public.products
    SET stock_quantity = v_new_quantity
    WHERE id = v_product.id;

    INSERT INTO public.inventory_transactions (
      product_id, type, quantity, previous_quantity, new_quantity,
      unit_cost, total_cost, reference_id, reference_type, notes, performed_by
    )
    VALUES (
      v_product.id, 'sale', v_line.quantity::integer, v_product.stock_quantity, v_new_quantity,
      v_line.unit_cost, v_line.total_cost, NEW.source_id, 'invoice',
      'Stock relieved for issued invoice journal ' || NEW.entry_number, NEW.created_by
    );
  END LOOP;

  RETURN NEW;
END;
$invoice_inventory_posting$;

CREATE TRIGGER post_invoice_inventory_movement_after_journal
AFTER INSERT ON public.journal_entries
FOR EACH ROW
WHEN (NEW.source_type = 'invoice')
EXECUTE FUNCTION public.post_invoice_inventory_movement();

REVOKE ALL ON FUNCTION public.guard_product_inventory_value_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_invoice_stock_issue() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_invoice_inventory_movement() FROM PUBLIC, anon, authenticated;


-- Service catalogue items are not inventory assets and must never inherit a
-- product purchase valuation as inventory COGS.
CREATE OR REPLACE FUNCTION public.snapshot_invoice_item_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $snapshot_cost$
DECLARE
  v_cost numeric(14,4);
  v_verified boolean;
  v_is_service boolean;
BEGIN
  IF NEW.product_id IS NULL THEN
    NEW.unit_cost := NULL;
    NEW.cost_source := NULL;
    RETURN NEW;
  END IF;

  SELECT cost_price, cost_price_verified, COALESCE(is_service, false)
    INTO v_cost, v_verified, v_is_service
  FROM public.products
  WHERE id = NEW.product_id
    AND deleted_at IS NULL;

  IF v_is_service THEN
    NEW.unit_cost := NULL;
    NEW.cost_source := NULL;
  ELSIF COALESCE(v_verified, false) AND v_cost IS NOT NULL AND v_cost >= 0 THEN
    NEW.unit_cost := v_cost;
    NEW.cost_source := 'verified_weighted_average';
  ELSE
    NEW.unit_cost := NULL;
    NEW.cost_source := NULL;
  END IF;

  RETURN NEW;
END;
$snapshot_cost$;



-- Evidenced direct costs for service/manual invoice lines. These debit COGS
-- directly and credit Cash/Bank; they never touch Inventory.
CREATE TABLE IF NOT EXISTS public.invoice_item_direct_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid NOT NULL UNIQUE REFERENCES public.invoice_items(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  source_reference text NOT NULL CHECK (length(btrim(source_reference)) > 0),
  incurred_on date NOT NULL,
  payment_method public.payment_method NOT NULL,
  notes text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  journal_entry_id uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'invoice'::text, 'payment'::text, 'receipt'::text, 'receipt_void'::text,
    'stock_purchase'::text, 'opening_stock_valuation'::text,
    'petty_cash_expense'::text, 'direct_invoice_cost'::text
  ]));

CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_invoice_cost_journal_source
  ON public.journal_entries(source_type, source_id)
  WHERE source_type = 'direct_invoice_cost';

ALTER TABLE public.invoice_item_direct_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_item_direct_costs_finance_read
  ON public.invoice_item_direct_costs
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'cashier']));
GRANT SELECT ON public.invoice_item_direct_costs TO authenticated;

CREATE OR REPLACE FUNCTION public.record_invoice_item_direct_cost(
  p_invoice_item_id uuid,
  p_amount numeric,
  p_reference text,
  p_incurred_on date,
  p_payment_method public.payment_method,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $direct_invoice_cost$
DECLARE
  v_item public.invoice_items%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_cost_account uuid;
  v_payment_account uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_currency text;
  v_cost_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'You are not authorized to record direct invoice costs';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Direct cost must be greater than zero';
  END IF;
  IF NULLIF(BTRIM(p_reference), '') IS NULL THEN
    RAISE EXCEPTION 'A supplier, payroll or other supporting cost reference is required';
  END IF;
  IF p_incurred_on IS NULL OR p_payment_method IS NULL THEN
    RAISE EXCEPTION 'Cost date and payment method are required';
  END IF;

  SELECT * INTO v_item
  FROM public.invoice_items
  WHERE id = p_invoice_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice line not found';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_item.invoice_id AND deleted_at IS NULL;
  IF NOT FOUND OR v_invoice.status NOT IN ('issued', 'partially_paid', 'paid', 'overdue') THEN
    RAISE EXCEPTION 'Direct costs can only be recorded against issued invoices';
  END IF;

  IF v_item.product_id IS NOT NULL THEN
    SELECT * INTO v_product FROM public.products WHERE id = v_item.product_id;
    IF FOUND AND NOT COALESCE(v_product.is_service, false) THEN
      RAISE EXCEPTION 'Physical products must use verified purchase cost or historical cost verification, not direct service cost';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoice_item_direct_costs
    WHERE invoice_item_id = p_invoice_item_id
  ) OR EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE source_type = 'direct_invoice_cost' AND source_id = p_invoice_item_id
  ) THEN
    RAISE EXCEPTION 'A direct cost has already been recorded for this invoice line';
  END IF;

  SELECT id INTO v_cost_account
  FROM public.chart_of_accounts
  WHERE code = '5000' AND account_type = 'expense' AND is_active
  LIMIT 1;
  IF p_payment_method = 'cash' THEN
    SELECT id INTO v_payment_account FROM public.chart_of_accounts
    WHERE code = '1000' AND account_type = 'asset' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_payment_account FROM public.chart_of_accounts
    WHERE code = '1010' AND account_type = 'asset' AND is_active LIMIT 1;
  END IF;
  IF v_cost_account IS NULL OR v_payment_account IS NULL THEN
    RAISE EXCEPTION 'Cost of sales or payment account is not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  )
  VALUES (
    v_entry_number, p_incurred_on,
    'Direct service cost - invoice ' || v_invoice.invoice_number || ' - ' || v_item.description,
    'direct_invoice_cost', p_invoice_item_id, v_currency, auth.uid()
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  )
  VALUES
    (v_journal_id, 1, v_cost_account, 'Direct cost - ' || v_item.description, ROUND(p_amount, 2), 0),
    (v_journal_id, 2, v_payment_account, 'Direct cost paid - ' || v_item.description, 0, ROUND(p_amount, 2));

  INSERT INTO public.invoice_item_direct_costs (
    invoice_item_id, amount, source_reference, incurred_on,
    payment_method, notes, recorded_by, journal_entry_id
  )
  VALUES (
    p_invoice_item_id, ROUND(p_amount, 2), BTRIM(p_reference), p_incurred_on,
    p_payment_method, NULLIF(BTRIM(p_notes), ''), auth.uid(), v_journal_id
  )
  RETURNING id INTO v_cost_id;

  RETURN v_cost_id;
END;
$direct_invoice_cost$;

REVOKE ALL ON FUNCTION public.record_invoice_item_direct_cost(uuid, numeric, text, date, public.payment_method, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_item_direct_cost(uuid, numeric, text, date, public.payment_method, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_posted_direct_invoice_cost_mutations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $direct_cost_guard$
BEGIN
  RAISE EXCEPTION 'A posted direct invoice cost is immutable; correct it through an audited reversal';
END;
$direct_cost_guard$;

CREATE TRIGGER guard_posted_direct_invoice_cost_mutations
BEFORE UPDATE OR DELETE ON public.invoice_item_direct_costs
FOR EACH ROW
EXECUTE FUNCTION public.guard_posted_direct_invoice_cost_mutations();

REVOKE ALL ON FUNCTION public.guard_posted_direct_invoice_cost_mutations() FROM PUBLIC, anon, authenticated;



-- Mixed invoices may contain both physical products and service/manual lines.
-- Only physical stock lines require a verified inventory unit cost for COGS.
-- Service/manual costs are recorded independently and must not block physical COGS.
CREATE OR REPLACE FUNCTION public.set_historical_invoice_item_cost(
  p_invoice_item_id uuid,
  p_unit_cost numeric,
  p_reference text,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $historical_cost_v2$
DECLARE
  v_item public.invoice_items%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_journal_id uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_cogs_total numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can verify historical product costs';
  END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'Enter a valid historical unit cost';
  END IF;
  IF NULLIF(BTRIM(p_reference), '') IS NULL THEN
    RAISE EXCEPTION 'A supplier invoice, receipt or other source reference is required';
  END IF;

  SELECT * INTO v_item
  FROM public.invoice_items
  WHERE id = p_invoice_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice line was not found';
  END IF;

  IF v_item.product_id IS NULL OR EXISTS (
    SELECT 1 FROM public.products
    WHERE id = v_item.product_id AND is_service = true
  ) THEN
    RAISE EXCEPTION 'Service and manual invoice lines require a separate evidenced direct-cost workflow; they cannot be credited against inventory';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_item.invoice_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_invoice.status NOT IN ('issued', 'partially_paid', 'paid', 'overdue') THEN
    RAISE EXCEPTION 'Historical cost verification is available only for issued invoices';
  END IF;

  SELECT id INTO v_journal_id
  FROM public.journal_entries
  WHERE source_type = 'invoice' AND source_id = v_invoice.id;
  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'The invoice has no posted journal entry to receive its cost-of-sales posting';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_lines jl
    JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
    WHERE jl.journal_entry_id = v_journal_id AND coa.code = '5000'
  ) THEN
    RAISE EXCEPTION 'Cost of goods sold is already posted for this invoice; reverse and repost through a controlled correction';
  END IF;

  PERFORM set_config('app.historical_cost_rpc', 'on', true);
  UPDATE public.invoice_items
  SET unit_cost = ROUND(p_unit_cost, 4),
      cost_source = 'historical_verified',
      cost_verified_by = auth.uid(),
      cost_verified_at = now(),
      cost_reference = NULLIF(BTRIM(p_reference), ''),
      cost_notes = NULLIF(BTRIM(p_notes), '')
  WHERE id = p_invoice_item_id;

  -- Do not let service/manual lines with NULL unit_cost block physical COGS.
  IF NOT EXISTS (
    SELECT 1
    FROM public.invoice_items ii
    JOIN public.products p ON p.id = ii.product_id
    WHERE ii.invoice_id = v_invoice.id
      AND COALESCE(p.is_service, false) = false
      AND ii.unit_cost IS NULL
  ) THEN
    SELECT ROUND(COALESCE(SUM(ii.quantity * ii.unit_cost), 0), 2)
      INTO v_cogs_total
    FROM public.invoice_items ii
    JOIN public.products p ON p.id = ii.product_id
    WHERE ii.invoice_id = v_invoice.id
      AND COALESCE(p.is_service, false) = false;

    IF v_cogs_total > 0 THEN
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
        (v_journal_id, 9998, v_cogs_account, 'Verified historical cost of goods sold - ' || v_invoice.invoice_number, v_cogs_total, 0),
        (v_journal_id, 9999, v_inventory_account, 'Verified historical inventory relief - ' || v_invoice.invoice_number, 0, v_cogs_total);
    END IF;
  END IF;

  RETURN p_invoice_item_id;
END;
$historical_cost_v2$;

CREATE OR REPLACE FUNCTION public.post_invoice_cogs_after_receivable_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $invoice_cogs_v2$
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
    SELECT 1
    FROM public.journal_lines jl
    JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
    WHERE jl.journal_entry_id = NEW.journal_entry_id AND coa.code = '5000'
  ) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_items ii
    JOIN public.products p ON p.id = ii.product_id
    WHERE ii.invoice_id = v_invoice_id
      AND COALESCE(p.is_service, false) = false
      AND ii.unit_cost IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  SELECT ROUND(COALESCE(SUM(ii.quantity * ii.unit_cost), 0), 2)
    INTO v_cogs_total
  FROM public.invoice_items ii
  JOIN public.products p ON p.id = ii.product_id
  WHERE ii.invoice_id = v_invoice_id
    AND COALESCE(p.is_service, false) = false;

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
$invoice_cogs_v2$;

-- Never allow an issued invoice to be silently canceled while its revenue,
-- receivable, payments and inventory movements remain posted. A future
-- credit-note/reversal RPC may set this transaction-local flag after posting
-- all required reversals atomically.
CREATE OR REPLACE FUNCTION public.guard_issued_invoice_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $invoice_cancel_guard$
BEGIN
  IF NEW.status = 'canceled'
     AND OLD.status IN ('issued', 'partially_paid', 'paid', 'overdue')
     AND COALESCE(current_setting('app.invoice_reversal_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION 'An issued invoice cannot be canceled directly; create an audited credit note or reversal first';
  END IF;
  RETURN NEW;
END;
$invoice_cancel_guard$;

DROP TRIGGER IF EXISTS guard_issued_invoice_cancellation ON public.invoices;
CREATE TRIGGER guard_issued_invoice_cancellation
BEFORE UPDATE OF status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.guard_issued_invoice_cancellation();

REVOKE ALL ON FUNCTION public.guard_issued_invoice_cancellation() FROM PUBLIC, anon, authenticated;


-- A source invoice with payments or a journal posting is accounting evidence,
-- not a disposable draft. Soft deletion must not hide it from operational views
-- while leaving its receivable/revenue/payment history in the ledger.
CREATE OR REPLACE FUNCTION public.guard_posted_invoice_soft_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $invoice_delete_guard$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.journal_entries
      WHERE source_type = 'invoice' AND source_id = OLD.id
    )
    OR EXISTS (
      SELECT 1 FROM public.payments
      WHERE invoice_id = OLD.id AND deleted_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'An invoice with posted accounting or payment history cannot be deleted; use an audited credit note or reversal';
  END IF;
  RETURN NEW;
END;
$invoice_delete_guard$;

DROP TRIGGER IF EXISTS guard_posted_invoice_soft_deletion ON public.invoices;
CREATE TRIGGER guard_posted_invoice_soft_deletion
BEFORE UPDATE OF deleted_at ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.guard_posted_invoice_soft_deletion();

REVOKE ALL ON FUNCTION public.guard_posted_invoice_soft_deletion() FROM PUBLIC, anon, authenticated;


-- These integrity triggers must inspect protected accounting rows even when the
-- caller's SELECT policies do not expose those rows. Run the checks with the
-- migration owner privileges and a locked-down search_path.
CREATE OR REPLACE FUNCTION public.guard_issued_invoice_item_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $issued_invoice_item_guard_v2$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.invoices
  WHERE id = OLD.invoice_id;

  IF v_status IN ('issued', 'partially_paid', 'paid', 'overdue')
     AND (NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.quantity IS DISTINCT FROM OLD.quantity
       OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
       OR NEW.description IS DISTINCT FROM OLD.description) THEN
    RAISE EXCEPTION 'Issued invoice lines are immutable; use a credit note or audited correction';
  END IF;
  RETURN NEW;
END;
$issued_invoice_item_guard_v2$;

REVOKE ALL ON FUNCTION public.guard_issued_invoice_item_mutations() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_posted_invoice_soft_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $invoice_delete_guard_v2$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.journal_entries
      WHERE source_type = 'invoice' AND source_id = OLD.id
    )
    OR EXISTS (
      SELECT 1 FROM public.payments
      WHERE invoice_id = OLD.id AND deleted_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'An invoice with posted accounting or payment history cannot be deleted; use an audited credit note or reversal';
  END IF;
  RETURN NEW;
END;
$invoice_delete_guard_v2$;

REVOKE ALL ON FUNCTION public.guard_posted_invoice_soft_deletion() FROM PUBLIC, anon, authenticated;


-- Audited inventory damage/shrinkage: stock is relieved at verified weighted
-- average cost and the same transaction posts Inventory Shrinkage expense.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_transactions_idempotency_key_uidx
  ON public.inventory_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'invoice'::text, 'payment'::text, 'receipt'::text, 'receipt_void'::text,
    'stock_purchase'::text, 'opening_stock_valuation'::text,
    'petty_cash_expense'::text, 'direct_invoice_cost'::text,
    'inventory_damage'::text
  ]));

INSERT INTO public.chart_of_accounts (
  code, name, description, account_type, account_subtype, is_system, is_active
)
VALUES (
  '6500',
  'Inventory Shrinkage & Damage',
  'Verified cost of stock lost through damage, spoilage or shrinkage.',
  'expense',
  'other_expense',
  true,
  true
)
ON CONFLICT (code) DO NOTHING;

DO $inventory_damage_account$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
    WHERE code = '6500' AND account_type = 'expense' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Chart of accounts code 6500 must be an active expense account';
  END IF;
END;
$inventory_damage_account$;

-- Extend the guarded inventory update path only for the audited adjustment RPC.
CREATE OR REPLACE FUNCTION public.guard_product_inventory_value_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $product_inventory_guard_v2$
BEGIN
  IF (NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity
      OR NEW.cost_price IS DISTINCT FROM OLD.cost_price
      OR NEW.cost_price_verified IS DISTINCT FROM OLD.cost_price_verified)
     AND COALESCE(current_setting('app.stock_purchase_rpc', true), '') <> 'on'
     AND COALESCE(current_setting('app.invoice_stock_posting', true), '') <> 'on'
     AND COALESCE(current_setting('app.inventory_adjustment_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Stock quantity and verified inventory valuation can only be changed by audited purchase, invoice or adjustment workflows';
  END IF;
  RETURN NEW;
END;
$product_inventory_guard_v2$;

CREATE OR REPLACE FUNCTION public.guard_posted_inventory_transaction_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $posted_inventory_guard_v2$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to change inventory records';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_entries
    WHERE source_id = OLD.id
      AND source_type IN ('stock_purchase', 'inventory_damage')
  ) THEN
    RAISE EXCEPTION 'An inventory transaction with a posted journal is immutable; record an audited reversal instead';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$posted_inventory_guard_v2$;

CREATE OR REPLACE FUNCTION public.record_inventory_damage(
  p_product_id uuid,
  p_quantity integer,
  p_reference_number text,
  p_idempotency_key uuid,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $inventory_damage$
DECLARE
  v_product public.products%ROWTYPE;
  v_existing public.inventory_transactions%ROWTYPE;
  v_transaction_id uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_inventory_account uuid;
  v_damage_account uuid;
  v_currency text;
  v_new_quantity integer;
  v_total_cost numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can record stock damage';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Damage quantity must be a positive whole number';
  END IF;
  IF NULLIF(BTRIM(p_reference_number), '') IS NULL THEN
    RAISE EXCEPTION 'A damage report, incident reference or supporting document reference is required';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required to record stock damage';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  SELECT * INTO v_existing
  FROM public.inventory_transactions
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.type <> 'damage'
      OR v_existing.product_id <> p_product_id
      OR v_existing.quantity <> p_quantity
      OR v_existing.reference_number IS DISTINCT FROM BTRIM(p_reference_number) THEN
      RAISE EXCEPTION 'This damage idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_product.is_service, false) THEN
    RAISE EXCEPTION 'Select an active physical product';
  END IF;
  IF COALESCE(v_product.stock_quantity, 0) < p_quantity THEN
    RAISE EXCEPTION 'Damage quantity exceeds available stock';
  END IF;
  IF NOT COALESCE(v_product.cost_price_verified, false)
     OR v_product.cost_price IS NULL OR v_product.cost_price < 0 THEN
    RAISE EXCEPTION 'Verify the actual purchase cost before recording inventory damage';
  END IF;

  v_new_quantity := COALESCE(v_product.stock_quantity, 0) - p_quantity;
  v_total_cost := ROUND(p_quantity * v_product.cost_price, 2);

  SELECT id INTO v_inventory_account
  FROM public.chart_of_accounts
  WHERE code = '1200' AND account_type = 'asset' AND is_active
  LIMIT 1;
  SELECT id INTO v_damage_account
  FROM public.chart_of_accounts
  WHERE code = '6500' AND account_type = 'expense' AND is_active
  LIMIT 1;
  IF v_inventory_account IS NULL OR v_damage_account IS NULL THEN
    RAISE EXCEPTION 'Inventory or Inventory Shrinkage account is not configured';
  END IF;

  PERFORM set_config('app.inventory_adjustment_rpc', 'on', true);
  UPDATE public.products
  SET stock_quantity = v_new_quantity
  WHERE id = p_product_id;

  INSERT INTO public.inventory_transactions (
    product_id, type, quantity, previous_quantity, new_quantity,
    unit_cost, total_cost, reference_type, reference_number, notes,
    performed_by, idempotency_key
  )
  VALUES (
    p_product_id, 'damage', p_quantity, v_product.stock_quantity, v_new_quantity,
    v_product.cost_price, v_total_cost, 'inventory_damage', BTRIM(p_reference_number),
    NULLIF(BTRIM(p_notes), ''), auth.uid(), p_idempotency_key
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
    v_entry_number, CURRENT_DATE,
    'Inventory damage - ' || v_product.name || ' - ' || BTRIM(p_reference_number),
    'inventory_damage', v_transaction_id, v_currency, auth.uid()
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  )
  VALUES
    (v_journal_id, 1, v_damage_account, 'Inventory damage - ' || v_product.name, v_total_cost, 0),
    (v_journal_id, 2, v_inventory_account, 'Inventory written off - ' || v_product.name, 0, v_total_cost);

  RETURN v_transaction_id;
END;
$inventory_damage$;

REVOKE ALL ON FUNCTION public.record_inventory_damage(uuid, integer, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_inventory_damage(uuid, integer, text, uuid, text) TO authenticated;


-- Inventory transaction history is append-only from the client. Purchases,
-- invoice sales and damage are inserted only by their SECURITY DEFINER RPCs.
-- Employees retain the existing read policy; the old ALL policy would have
-- allowed fabricated transaction rows that did not move stock or post a journal.
DROP POLICY IF EXISTS "Admins accountants cashiers manage inventory"
  ON public.inventory_transactions;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_damage_journal_source
  ON public.journal_entries(source_type, source_id)
  WHERE source_type = 'inventory_damage';


-- A catalogue item cannot be reclassified between physical stock and a service
-- after it has been used by inventory or invoice history. This keeps old COGS,
-- stock movements and service direct costs interpretable.
CREATE OR REPLACE FUNCTION public.guard_product_service_type_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $product_service_type_guard$
BEGIN
  IF NEW.is_service IS DISTINCT FROM OLD.is_service AND (
    COALESCE(OLD.stock_quantity, 0) > 0
    OR EXISTS (
      SELECT 1 FROM public.inventory_transactions
      WHERE product_id = OLD.id
    )
    OR EXISTS (
      SELECT 1 FROM public.invoice_items
      WHERE product_id = OLD.id
    )
  ) THEN
    RAISE EXCEPTION 'Product type cannot be changed after stock or invoice history exists; create a correctly classified item and use an audited correction';
  END IF;
  RETURN NEW;
END;
$product_service_type_guard$;

CREATE TRIGGER guard_product_service_type_changes
BEFORE UPDATE OF is_service ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.guard_product_service_type_changes();

REVOKE ALL ON FUNCTION public.guard_product_service_type_changes() FROM PUBLIC, anon, authenticated;
