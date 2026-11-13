-- Audited customer credit notes, stock returns and customer-credit settlement.
-- Issued invoices remain immutable; credits are separate documents and balanced journals.
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
    'inventory_count_adjustment'::text, 'stock_purchase_reversal'::text,
    'credit_note'::text, 'customer_credit_application'::text,
    'customer_credit_refund'::text
  ]));

DO $customer_credit_account$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
    WHERE code = '2200' AND account_type = 'liability' AND is_active
  ) THEN
    RAISE EXCEPTION 'Active customer deposits / customer credit liability account 2200 is required';
  END IF;
END;
$customer_credit_account$;

CREATE TABLE public.credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_number text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  credit_note_date date NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  reference_number text NOT NULL CHECK (length(btrim(reference_number)) > 0),
  subtotal numeric(15,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  receivable_applied numeric(15,2) NOT NULL DEFAULT 0 CHECK (receivable_applied >= 0),
  customer_credit_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (customer_credit_amount >= 0),
  journal_entry_id uuid UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL UNIQUE,
  request_fingerprint text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_amount = subtotal + tax_amount),
  CHECK (total_amount = receivable_applied + customer_credit_amount)
);

CREATE INDEX credit_notes_invoice_idx ON public.credit_notes(invoice_id, credit_note_date DESC);
CREATE INDEX credit_notes_customer_idx ON public.credit_notes(customer_id, credit_note_date DESC);

CREATE TABLE public.credit_note_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid NOT NULL REFERENCES public.credit_notes(id) ON DELETE RESTRICT,
  invoice_item_id uuid NOT NULL REFERENCES public.invoice_items(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  description text NOT NULL,
  quantity numeric(15,3) NOT NULL CHECK (quantity > 0),
  net_amount numeric(15,2) NOT NULL CHECK (net_amount >= 0),
  tax_amount numeric(15,2) NOT NULL CHECK (tax_amount >= 0),
  total_amount numeric(15,2) NOT NULL CHECK (total_amount = net_amount + tax_amount),
  is_inventory_item boolean NOT NULL DEFAULT false,
  unit_cost numeric(14,4),
  inventory_cost numeric(15,2) NOT NULL DEFAULT 0 CHECK (inventory_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (credit_note_id, invoice_item_id)
);
CREATE INDEX credit_note_lines_source_item_idx ON public.credit_note_lines(invoice_item_id);

CREATE TABLE public.credit_note_line_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_line_id uuid NOT NULL REFERENCES public.credit_note_lines(id) ON DELETE RESTRICT,
  source_invoice_item_tax_id uuid NOT NULL REFERENCES public.invoice_item_taxes(id) ON DELETE RESTRICT,
  tax_id uuid NOT NULL REFERENCES public.taxes(id) ON DELETE RESTRICT,
  tax_name text NOT NULL,
  tax_code text NOT NULL,
  tax_rate numeric(8,4) NOT NULL CHECK (tax_rate >= 0),
  is_compound boolean NOT NULL,
  tax_order integer NOT NULL CHECK (tax_order >= 0),
  taxable_amount numeric(15,2) NOT NULL CHECK (taxable_amount >= 0),
  tax_amount numeric(15,2) NOT NULL CHECK (tax_amount >= 0),
  liability_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (credit_note_line_id, tax_id)
);

CREATE TABLE public.customer_credit_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid NOT NULL REFERENCES public.credit_notes(id) ON DELETE RESTRICT,
  applied_to_invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  applied_on date NOT NULL,
  reference_number text NOT NULL CHECK (length(btrim(reference_number)) > 0),
  journal_entry_id uuid UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL UNIQUE,
  request_fingerprint text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.customer_credit_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid NOT NULL REFERENCES public.credit_notes(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  refunded_on date NOT NULL,
  payment_method public.payment_method NOT NULL,
  reference_number text NOT NULL CHECK (length(btrim(reference_number)) > 0),
  journal_entry_id uuid UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL UNIQUE,
  request_fingerprint text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_credit_applications_note_idx ON public.customer_credit_applications(credit_note_id);
CREATE INDEX customer_credit_refunds_note_idx ON public.customer_credit_refunds(credit_note_id);

ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_line_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_credit_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_credit_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY credit_notes_finance_read ON public.credit_notes
  FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['admin','accountant','auditor']));
CREATE POLICY credit_note_lines_finance_read ON public.credit_note_lines
  FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['admin','accountant','auditor']));
CREATE POLICY credit_note_line_taxes_finance_read ON public.credit_note_line_taxes
  FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['admin','accountant','auditor']));
CREATE POLICY customer_credit_applications_finance_read ON public.customer_credit_applications
  FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['admin','accountant','auditor']));
CREATE POLICY customer_credit_refunds_finance_read ON public.customer_credit_refunds
  FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['admin','accountant','auditor']));

GRANT SELECT ON public.credit_notes, public.credit_note_lines, public.credit_note_line_taxes,
  public.customer_credit_applications, public.customer_credit_refunds TO authenticated;
REVOKE ALL ON public.credit_notes, public.credit_note_lines, public.credit_note_line_taxes,
  public.customer_credit_applications, public.customer_credit_refunds FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.guard_credit_note_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $credit_note_immutable$
BEGIN
  IF COALESCE(current_setting('app.credit_note_rpc', true), '') <> 'on'
     AND COALESCE(current_setting('app.customer_credit_settlement_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Credit notes and customer-credit settlements are immutable; use their audited RPC workflows';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$credit_note_immutable$;

CREATE TRIGGER guard_credit_notes BEFORE INSERT OR UPDATE OR DELETE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_credit_note_records();
CREATE TRIGGER guard_credit_note_lines BEFORE INSERT OR UPDATE OR DELETE ON public.credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_credit_note_records();
CREATE TRIGGER guard_credit_note_line_taxes BEFORE INSERT OR UPDATE OR DELETE ON public.credit_note_line_taxes
  FOR EACH ROW EXECUTE FUNCTION public.guard_credit_note_records();
CREATE TRIGGER guard_customer_credit_applications BEFORE INSERT OR UPDATE OR DELETE ON public.customer_credit_applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_credit_note_records();
CREATE TRIGGER guard_customer_credit_refunds BEFORE INSERT OR UPDATE OR DELETE ON public.customer_credit_refunds
  FOR EACH ROW EXECUTE FUNCTION public.guard_credit_note_records();
REVOKE ALL ON FUNCTION public.guard_credit_note_records() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_invoice_credit_note(
  p_invoice_id uuid,
  p_lines jsonb,
  p_credit_note_date date,
  p_reason text,
  p_reference_number text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $record_invoice_credit_note$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_item public.invoice_items%ROWTYPE;
  v_tax record;
  v_request record;
  v_credit_note_id uuid := gen_random_uuid();
  v_credit_note_number text;
  v_existing_id uuid;
  v_existing_fingerprint text;
  v_fingerprint text;
  v_net numeric(15,2);
  v_tax_total numeric(15,2);
  v_line_tax numeric(15,2);
  v_taxable numeric(15,2);
  v_prev_qty numeric(15,3);
  v_remaining_qty numeric(15,3);
  v_prev_net numeric(15,2);
  v_prev_tax numeric(15,2);
  v_prev_taxable numeric(15,2);
  v_inventory_cost numeric(15,2);
  v_unit_cost numeric(14,4);
  v_previous_quantity integer;
  v_new_quantity integer;
  v_is_service boolean;
  v_is_inventory boolean;
  v_subtotal numeric(15,2) := 0;
  v_total_tax numeric(15,2) := 0;
  v_total_amount numeric(15,2) := 0;
  v_total_inventory_cost numeric(15,2) := 0;
  v_receivable_applied numeric(15,2) := 0;
  v_customer_credit numeric(15,2) := 0;
  v_ar_account uuid;
  v_revenue_account uuid;
  v_customer_credit_account uuid;
  v_inventory_account uuid;
  v_cogs_account uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_currency text;
  v_line_number integer := 1;
  v_debits numeric(15,2);
  v_credits numeric(15,2);
  v_note_line_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin','accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can issue customer credit notes';
  END IF;
  IF p_invoice_id IS NULL OR p_credit_note_date IS NULL OR p_idempotency_key IS NULL
     OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Invoice, credit date, idempotency key and at least one credit line are required';
  END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL OR NULLIF(BTRIM(p_reference_number), '') IS NULL THEN
    RAISE EXCEPTION 'A reason and supporting reference are required for every credit note';
  END IF;

  v_fingerprint := md5(p_invoice_id::text || '|' || p_lines::text || '|' ||
    p_credit_note_date::text || '|' || BTRIM(p_reason) || '|' || BTRIM(p_reference_number));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT id, request_fingerprint INTO v_existing_id, v_existing_fingerprint
  FROM public.credit_notes WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This credit-note idempotency key was already used with different details';
    END IF;
    RETURN v_existing_id;
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_invoice.status NOT IN ('issued','partially_paid','paid','overdue') THEN
    RAISE EXCEPTION 'Credit notes can only be issued against an active issued invoice';
  END IF;
  IF p_credit_note_date < v_invoice.issue_date THEN
    RAISE EXCEPTION 'Credit note date cannot be earlier than the original invoice date';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE source_type = 'invoice' AND source_id = p_invoice_id
  ) THEN
    RAISE EXCEPTION 'The original invoice must have a posted journal before it can be credited';
  END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(p_lines)) <>
     (SELECT count(DISTINCT (value->>'invoice_item_id')) FROM jsonb_array_elements(p_lines)) THEN
    RAISE EXCEPTION 'Each original invoice line may appear only once per credit note';
  END IF;

  PERFORM set_config('app.credit_note_rpc', 'on', true);

  v_credit_note_number := 'CN-' || upper(substr(replace(v_credit_note_id::text, '-', ''), 1, 12));
  INSERT INTO public.credit_notes (
    id, credit_note_number, invoice_id, customer_id, credit_note_date,
    reason, reference_number, idempotency_key, request_fingerprint, created_by
  ) VALUES (
    v_credit_note_id, v_credit_note_number, v_invoice.id, v_invoice.customer_id,
    p_credit_note_date, BTRIM(p_reason), BTRIM(p_reference_number),
    p_idempotency_key, v_fingerprint, auth.uid()
  );

  FOR v_request IN
    SELECT * FROM jsonb_to_recordset(p_lines) AS x(invoice_item_id uuid, quantity numeric)
    ORDER BY invoice_item_id
  LOOP
    IF v_request.invoice_item_id IS NULL OR v_request.quantity IS NULL OR v_request.quantity <= 0
       OR v_request.quantity <> ROUND(v_request.quantity,3) THEN
      RAISE EXCEPTION 'Every credit line requires a valid invoice item and a positive quantity with at most three decimal places';
    END IF;

    SELECT * INTO v_item
    FROM public.invoice_items
    WHERE id = v_request.invoice_item_id AND invoice_id = v_invoice.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected credit line does not belong to the original invoice';
    END IF;

    SELECT COALESCE(p.is_service, false)
    INTO v_is_service
    FROM public.products p
    WHERE p.id = v_item.product_id;
    v_is_service := COALESCE(v_is_service, false);
    v_is_inventory := v_item.product_id IS NOT NULL AND NOT v_is_service;

    SELECT COALESCE(SUM(cnl.quantity),0), COALESCE(SUM(cnl.net_amount),0)
    INTO v_prev_qty, v_prev_net
    FROM public.credit_note_lines cnl
    WHERE cnl.invoice_item_id = v_item.id;

    v_remaining_qty := v_item.quantity - v_prev_qty;
    IF v_request.quantity > v_remaining_qty THEN
      RAISE EXCEPTION 'Credit quantity exceeds the uncredited quantity remaining for invoice line %', v_item.id;
    END IF;

    IF v_item.line_total < v_item.tax_amount THEN
      RAISE EXCEPTION 'Original invoice line totals are invalid and cannot be credited';
    END IF;
    v_net := ROUND(v_item.line_total - v_item.tax_amount, 2);
    IF v_net < v_prev_net THEN
      RAISE EXCEPTION 'Previously issued credits exceed the original invoice line value';
    END IF;
    IF v_request.quantity = v_remaining_qty THEN
      v_net := ROUND(v_net - v_prev_net, 2);
    ELSE
      v_net := ROUND((v_net * v_request.quantity) / NULLIF(v_item.quantity,0), 2);
    END IF;

    SELECT COALESCE(SUM(tax_amount),0), COUNT(*)
    INTO v_prev_tax, v_tax_total
    FROM public.invoice_item_taxes
    WHERE invoice_item_id = v_item.id;
    IF ROUND(v_prev_tax,2) <> ROUND(COALESCE(v_item.tax_amount,0),2)
       AND (v_prev_tax > 0 OR v_item.tax_amount > 0) THEN
      RAISE EXCEPTION 'This invoice line lacks reconciled per-line tax evidence; reconstruct the tax allocation before issuing a credit note';
    END IF;
    IF v_item.tax_amount > 0 AND v_tax_total = 0 THEN
      RAISE EXCEPTION 'Historical taxed invoice lines without per-line tax snapshots cannot be credited';
    END IF;

    v_line_tax := 0;
    FOR v_tax IN
      SELECT * FROM public.invoice_item_taxes
      WHERE invoice_item_id = v_item.id
      ORDER BY tax_order, tax_code
    LOOP
      SELECT COALESCE(SUM(cnt.tax_amount),0), COALESCE(SUM(cnt.taxable_amount),0)
      INTO v_prev_tax, v_prev_taxable
      FROM public.credit_note_line_taxes cnt
      JOIN public.credit_note_lines cnl ON cnl.id = cnt.credit_note_line_id
      WHERE cnl.invoice_item_id = v_item.id
        AND cnt.source_invoice_item_tax_id = v_tax.id;

      IF v_request.quantity = v_remaining_qty THEN
        v_tax_total := ROUND(v_tax.tax_amount - v_prev_tax,2);
        v_taxable := ROUND(v_tax.taxable_amount - v_prev_taxable,2);
      ELSE
        v_tax_total := ROUND(v_tax.tax_amount * v_request.quantity / NULLIF(v_item.quantity,0),2);
        v_taxable := ROUND(v_tax.taxable_amount * v_request.quantity / NULLIF(v_item.quantity,0),2);
      END IF;
      IF v_tax_total < 0 OR v_taxable < 0 THEN
        RAISE EXCEPTION 'Previously issued tax credits exceed the original tax allocation';
      END IF;
      v_line_tax := v_line_tax + v_tax_total;
    END LOOP;

    IF ROUND(v_line_tax,2) <> ROUND(
      CASE WHEN v_request.quantity = v_remaining_qty
        THEN v_item.tax_amount - COALESCE((
          SELECT SUM(cnl.tax_amount) FROM public.credit_note_lines cnl
          WHERE cnl.invoice_item_id = v_item.id
        ),0)
        ELSE ROUND(v_item.tax_amount * v_request.quantity / NULLIF(v_item.quantity,0),2)
      END, 2
    ) THEN
      RAISE EXCEPTION 'Per-line tax snapshots do not reconcile to the credit quantity allocation';
    END IF;

    v_inventory_cost := 0;
    v_unit_cost := NULL;
    IF v_is_inventory THEN
      IF v_item.quantity <> trunc(v_item.quantity) OR v_request.quantity <> trunc(v_request.quantity) THEN
        RAISE EXCEPTION 'Physical inventory returns must use whole-unit quantities';
      END IF;
      IF v_item.unit_cost IS NULL OR v_item.unit_cost < 0 THEN
        RAISE EXCEPTION 'This physical invoice line has no verified historical unit cost; verify cost before accepting a stock return';
      END IF;
      v_unit_cost := v_item.unit_cost;
      v_inventory_cost := ROUND(v_request.quantity * v_unit_cost,2);
    END IF;

    INSERT INTO public.credit_note_lines (
      credit_note_id, invoice_item_id, product_id, description, quantity,
      net_amount, tax_amount, total_amount, is_inventory_item, unit_cost, inventory_cost
    ) VALUES (
      v_credit_note_id, v_item.id, v_item.product_id, v_item.description,
      v_request.quantity, v_net, v_line_tax, v_net + v_line_tax,
      v_is_inventory, v_unit_cost, v_inventory_cost
    ) RETURNING id INTO v_note_line_id;

    FOR v_tax IN
      SELECT * FROM public.invoice_item_taxes
      WHERE invoice_item_id = v_item.id
      ORDER BY tax_order, tax_code
    LOOP
      SELECT COALESCE(SUM(cnt.tax_amount),0), COALESCE(SUM(cnt.taxable_amount),0)
      INTO v_prev_tax, v_prev_taxable
      FROM public.credit_note_line_taxes cnt
      JOIN public.credit_note_lines cnl ON cnl.id = cnt.credit_note_line_id
      WHERE cnl.invoice_item_id = v_item.id
        AND cnt.source_invoice_item_tax_id = v_tax.id
        AND cnl.credit_note_id <> v_credit_note_id;

      IF v_request.quantity = v_remaining_qty THEN
        v_tax_total := ROUND(v_tax.tax_amount - v_prev_tax,2);
        v_taxable := ROUND(v_tax.taxable_amount - v_prev_taxable,2);
      ELSE
        v_tax_total := ROUND(v_tax.tax_amount * v_request.quantity / NULLIF(v_item.quantity,0),2);
        v_taxable := ROUND(v_tax.taxable_amount * v_request.quantity / NULLIF(v_item.quantity,0),2);
      END IF;

      INSERT INTO public.credit_note_line_taxes (
        credit_note_line_id, source_invoice_item_tax_id, tax_id, tax_name,
        tax_code, tax_rate, is_compound, tax_order, taxable_amount,
        tax_amount, liability_account_id
      ) VALUES (
        v_note_line_id, v_tax.id, v_tax.tax_id, v_tax.tax_name,
        v_tax.tax_code, v_tax.tax_rate, v_tax.is_compound, v_tax.tax_order,
        v_taxable, v_tax_total, v_tax.liability_account_id
      );
    END LOOP;

    v_subtotal := v_subtotal + v_net;
    v_total_tax := v_total_tax + v_line_tax;
    v_total_inventory_cost := v_total_inventory_cost + v_inventory_cost;
  END LOOP;

  v_total_amount := ROUND(v_subtotal + v_total_tax,2);
  IF v_total_amount <= 0 AND v_total_inventory_cost <= 0 THEN
    RAISE EXCEPTION 'Credit note has no financial or inventory value';
  END IF;

  v_receivable_applied := LEAST(v_total_amount, GREATEST(0,ROUND(COALESCE(v_invoice.balance_due,0),2)));
  v_customer_credit := ROUND(v_total_amount - v_receivable_applied,2);

  UPDATE public.credit_notes
  SET subtotal = v_subtotal, tax_amount = v_total_tax, total_amount = v_total_amount,
      receivable_applied = v_receivable_applied, customer_credit_amount = v_customer_credit
  WHERE id = v_credit_note_id;

  SELECT id INTO v_ar_account FROM public.chart_of_accounts
  WHERE code='1100' AND account_type='asset' AND is_active LIMIT 1;
  SELECT id INTO v_revenue_account FROM public.chart_of_accounts
  WHERE code='4000' AND account_type='revenue' AND is_active LIMIT 1;
  SELECT id INTO v_customer_credit_account FROM public.chart_of_accounts
  WHERE code='2200' AND account_type='liability' AND is_active LIMIT 1;
  SELECT id INTO v_inventory_account FROM public.chart_of_accounts
  WHERE code='1200' AND account_type='asset' AND is_active LIMIT 1;
  SELECT id INTO v_cogs_account FROM public.chart_of_accounts
  WHERE code='5000' AND account_type='expense' AND is_active LIMIT 1;
  IF v_ar_account IS NULL OR v_revenue_account IS NULL OR v_customer_credit_account IS NULL
     OR (v_total_inventory_cost > 0 AND (v_inventory_account IS NULL OR v_cogs_account IS NULL)) THEN
    RAISE EXCEPTION 'Required revenue, receivable, customer credit, inventory or COGS accounts are not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code,'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency,'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  ) VALUES (
    v_entry_number, p_credit_note_date,
    'Credit note ' || v_credit_note_number || ' against invoice ' || v_invoice.invoice_number,
    'credit_note', v_credit_note_id, v_currency, auth.uid()
  ) RETURNING id INTO v_journal_id;

  IF v_subtotal > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id,line_number,account_id,description,debit,credit
    ) VALUES (
      v_journal_id,v_line_number,v_revenue_account,
      'Sales revenue reversal - ' || v_credit_note_number,v_subtotal,0
    );
    v_line_number := v_line_number + 1;
  END IF;

  FOR v_tax IN
    SELECT liability_account_id, ROUND(SUM(tax_amount),2) AS tax_amount
    FROM public.credit_note_line_taxes
    WHERE credit_note_line_id IN (SELECT id FROM public.credit_note_lines WHERE credit_note_id=v_credit_note_id)
    GROUP BY liability_account_id
    ORDER BY liability_account_id
  LOOP
    IF v_tax.tax_amount > 0 THEN
      INSERT INTO public.journal_lines (
        journal_entry_id,line_number,account_id,description,debit,credit
      ) VALUES (
        v_journal_id,v_line_number,v_tax.liability_account_id,
        'Sales tax reversal - ' || v_credit_note_number,v_tax.tax_amount,0
      );
      v_line_number := v_line_number + 1;
    END IF;
  END LOOP;

  IF v_receivable_applied > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id,line_number,account_id,description,debit,credit
    ) VALUES (
      v_journal_id,v_line_number,v_ar_account,
      'Accounts receivable credited - ' || v_credit_note_number,0,v_receivable_applied
    );
    v_line_number := v_line_number + 1;
  END IF;
  IF v_customer_credit > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id,line_number,account_id,description,debit,credit
    ) VALUES (
      v_journal_id,v_line_number,v_customer_credit_account,
      'Customer credit liability - ' || v_credit_note_number,0,v_customer_credit
    );
    v_line_number := v_line_number + 1;
  END IF;
  IF v_total_inventory_cost > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id,line_number,account_id,description,debit,credit
    ) VALUES
      (v_journal_id,v_line_number,v_inventory_account,'Returned inventory - ' || v_credit_note_number,v_total_inventory_cost,0),
      (v_journal_id,v_line_number+1,v_cogs_account,'Reverse cost of goods sold - ' || v_credit_note_number,0,v_total_inventory_cost);
  END IF;

  SELECT ROUND(COALESCE(SUM(debit),0),2), ROUND(COALESCE(SUM(credit),0),2)
  INTO v_debits,v_credits FROM public.journal_lines WHERE journal_entry_id=v_journal_id;
  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'Credit-note journal is not balanced (debits %, credits %)',v_debits,v_credits;
  END IF;

  UPDATE public.invoices
  SET balance_due = GREATEST(0,ROUND(COALESCE(balance_due,0)-v_receivable_applied,2))
  WHERE id = v_invoice.id;

  -- Stock is restored only for physical goods with verified original invoice cost.
  PERFORM set_config('app.inventory_adjustment_rpc','on',true);
  FOR v_request IN
    SELECT product_id, SUM(quantity)::integer AS quantity,
           ROUND(SUM(inventory_cost),2) AS total_cost,
           CASE WHEN SUM(quantity) > 0 THEN ROUND(SUM(inventory_cost)/SUM(quantity),4) ELSE 0 END AS unit_cost
    FROM public.credit_note_lines
    WHERE credit_note_id=v_credit_note_id AND is_inventory_item
    GROUP BY product_id
    ORDER BY product_id
  LOOP
    SELECT COALESCE(stock_quantity,0) INTO v_previous_quantity
    FROM public.products WHERE id=v_request.product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Returned product no longer exists'; END IF;
    v_new_quantity := v_previous_quantity + v_request.quantity;

    UPDATE public.products
    SET stock_quantity = v_new_quantity
    WHERE id=v_request.product_id;

    INSERT INTO public.inventory_transactions (
      product_id,type,quantity,previous_quantity,new_quantity,unit_cost,total_cost,
      reference_id,reference_type,reference_number,notes,performed_by,idempotency_key
    ) VALUES (
      v_request.product_id,'return',v_request.quantity,v_previous_quantity,
      v_new_quantity,v_request.unit_cost,v_request.total_cost,
      v_credit_note_id,'credit_note',v_credit_note_number,
      'Returned against invoice ' || v_invoice.invoice_number || ': ' || BTRIM(p_reason),
      auth.uid(),gen_random_uuid()
    );
  END LOOP;

  UPDATE public.credit_notes SET journal_entry_id=v_journal_id WHERE id=v_credit_note_id;
  RETURN v_credit_note_id;
END;
$record_invoice_credit_note$;

REVOKE ALL ON FUNCTION public.record_invoice_credit_note(uuid,jsonb,date,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_credit_note(uuid,jsonb,date,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_customer_credit(
  p_credit_note_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_applied_on date,
  p_reference_number text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $apply_customer_credit$
DECLARE
  v_note public.credit_notes%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_application_id uuid := gen_random_uuid();
  v_journal_id uuid;
  v_entry_number text;
  v_ar_account uuid;
  v_credit_account uuid;
  v_currency text;
  v_remaining numeric(15,2);
  v_fingerprint text;
  v_existing_id uuid;
  v_existing_fingerprint text;
  v_debits numeric(15,2);
  v_credits numeric(15,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin','accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can apply customer credit';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> ROUND(p_amount,2) OR p_applied_on IS NULL
     OR p_idempotency_key IS NULL OR NULLIF(BTRIM(p_reference_number),'') IS NULL THEN
    RAISE EXCEPTION 'A positive amount, date, reference and idempotency key are required';
  END IF;
  v_fingerprint := md5(p_credit_note_id::text||'|'||p_invoice_id::text||'|'||p_amount::text||'|'||p_applied_on::text||'|'||BTRIM(p_reference_number));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT id,request_fingerprint INTO v_existing_id,v_existing_fingerprint
  FROM public.customer_credit_applications WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This customer-credit application key was reused with different details';
    END IF;
    RETURN v_existing_id;
  END IF;

  SELECT * INTO v_note FROM public.credit_notes WHERE id=p_credit_note_id FOR UPDATE;
  IF NOT FOUND OR v_note.customer_credit_amount <= 0 THEN
    RAISE EXCEPTION 'The selected credit note has no customer credit balance';
  END IF;
  SELECT COALESCE(v_note.customer_credit_amount,0)
    - COALESCE((SELECT SUM(amount) FROM public.customer_credit_applications WHERE credit_note_id=v_note.id),0)
    - COALESCE((SELECT SUM(amount) FROM public.customer_credit_refunds WHERE credit_note_id=v_note.id),0)
  INTO v_remaining;
  IF p_amount > v_remaining THEN RAISE EXCEPTION 'Application exceeds the remaining customer credit'; END IF;
  IF p_applied_on < v_note.credit_note_date THEN
    RAISE EXCEPTION 'Customer credit application date cannot be earlier than the credit note';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices
  WHERE id=p_invoice_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_invoice.customer_id<>v_note.customer_id
     OR v_invoice.status NOT IN ('issued','partially_paid','overdue') THEN
    RAISE EXCEPTION 'Select an active outstanding invoice belonging to the same customer';
  END IF;
  IF p_applied_on < v_invoice.issue_date THEN
    RAISE EXCEPTION 'Customer credit application date cannot be earlier than the target invoice';
  END IF;
  IF p_amount > COALESCE(v_invoice.balance_due,0) THEN
    RAISE EXCEPTION 'Application exceeds the selected invoice balance';
  END IF;

  PERFORM set_config('app.customer_credit_settlement_rpc','on',true);
  INSERT INTO public.customer_credit_applications (
    id,credit_note_id,applied_to_invoice_id,amount,applied_on,reference_number,
    idempotency_key,request_fingerprint,created_by
  ) VALUES (
    v_application_id,v_note.id,v_invoice.id,ROUND(p_amount,2),p_applied_on,
    BTRIM(p_reference_number),p_idempotency_key,v_fingerprint,auth.uid()
  );

  SELECT id INTO v_ar_account FROM public.chart_of_accounts
  WHERE code='1100' AND account_type='asset' AND is_active LIMIT 1;
  SELECT id INTO v_credit_account FROM public.chart_of_accounts
  WHERE code='2200' AND account_type='liability' AND is_active LIMIT 1;
  IF v_ar_account IS NULL OR v_credit_account IS NULL THEN
    RAISE EXCEPTION 'Accounts receivable or customer credit liability account is not configured';
  END IF;

  v_entry_number:=public.get_next_sequence('journal');
  SELECT COALESCE(currency_code,'USD') INTO v_currency FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency:=COALESCE(v_currency,'USD');
  INSERT INTO public.journal_entries(entry_number,entry_date,description,source_type,source_id,currency,created_by)
  VALUES(v_entry_number,p_applied_on,'Customer credit applied to invoice','customer_credit_application',v_application_id,v_currency,auth.uid())
  RETURNING id INTO v_journal_id;
  INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
  VALUES
    (v_journal_id,1,v_credit_account,'Customer credit applied',ROUND(p_amount,2),0),
    (v_journal_id,2,v_ar_account,'Accounts receivable settled by customer credit',0,ROUND(p_amount,2));

  SELECT ROUND(SUM(debit),2),ROUND(SUM(credit),2) INTO v_debits,v_credits
  FROM public.journal_lines WHERE journal_entry_id=v_journal_id;
  IF v_debits<>v_credits THEN RAISE EXCEPTION 'Customer credit application journal is not balanced'; END IF;

  UPDATE public.invoices SET balance_due=GREATEST(0,ROUND(balance_due-p_amount,2)) WHERE id=v_invoice.id;
  UPDATE public.customer_credit_applications SET journal_entry_id=v_journal_id WHERE id=v_application_id;
  RETURN v_application_id;
END;
$apply_customer_credit$;

REVOKE ALL ON FUNCTION public.apply_customer_credit(uuid,uuid,numeric,date,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_customer_credit(uuid,uuid,numeric,date,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.refund_customer_credit(
  p_credit_note_id uuid,
  p_amount numeric,
  p_refunded_on date,
  p_payment_method public.payment_method,
  p_reference_number text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $refund_customer_credit$
DECLARE
  v_note public.credit_notes%ROWTYPE;
  v_refund_id uuid := gen_random_uuid();
  v_journal_id uuid;
  v_entry_number text;
  v_credit_account uuid;
  v_payment_account uuid;
  v_currency text;
  v_remaining numeric(15,2);
  v_fingerprint text;
  v_existing_id uuid;
  v_existing_fingerprint text;
  v_debits numeric(15,2);
  v_credits numeric(15,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin','accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can refund customer credit';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_amount <> ROUND(p_amount,2) OR p_refunded_on IS NULL
     OR p_payment_method IS NULL OR p_idempotency_key IS NULL
     OR NULLIF(BTRIM(p_reference_number),'') IS NULL THEN
    RAISE EXCEPTION 'A positive refund, date, payment method, reference and idempotency key are required';
  END IF;
  v_fingerprint:=md5(p_credit_note_id::text||'|'||p_amount::text||'|'||p_refunded_on::text||'|'||p_payment_method::text||'|'||BTRIM(p_reference_number));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT id,request_fingerprint INTO v_existing_id,v_existing_fingerprint
  FROM public.customer_credit_refunds WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This customer-credit refund key was reused with different details';
    END IF;
    RETURN v_existing_id;
  END IF;

  SELECT * INTO v_note FROM public.credit_notes WHERE id=p_credit_note_id FOR UPDATE;
  IF NOT FOUND OR v_note.customer_credit_amount<=0 THEN
    RAISE EXCEPTION 'The selected credit note has no refundable customer credit';
  END IF;
  IF p_refunded_on < v_note.credit_note_date THEN
    RAISE EXCEPTION 'Refund date cannot be earlier than the credit note';
  END IF;
  SELECT COALESCE(v_note.customer_credit_amount,0)
    - COALESCE((SELECT SUM(amount) FROM public.customer_credit_applications WHERE credit_note_id=v_note.id),0)
    - COALESCE((SELECT SUM(amount) FROM public.customer_credit_refunds WHERE credit_note_id=v_note.id),0)
  INTO v_remaining;
  IF p_amount>v_remaining THEN RAISE EXCEPTION 'Refund exceeds the remaining customer credit'; END IF;

  PERFORM set_config('app.customer_credit_settlement_rpc','on',true);
  INSERT INTO public.customer_credit_refunds(
    id,credit_note_id,amount,refunded_on,payment_method,reference_number,
    idempotency_key,request_fingerprint,created_by
  ) VALUES (
    v_refund_id,v_note.id,ROUND(p_amount,2),p_refunded_on,p_payment_method,
    BTRIM(p_reference_number),p_idempotency_key,v_fingerprint,auth.uid()
  );

  SELECT id INTO v_credit_account FROM public.chart_of_accounts
  WHERE code='2200' AND account_type='liability' AND is_active LIMIT 1;
  IF p_payment_method='cash' THEN
    SELECT id INTO v_payment_account FROM public.chart_of_accounts
    WHERE code='1000' AND account_type='asset' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_payment_account FROM public.chart_of_accounts
    WHERE code='1010' AND account_type='asset' AND is_active LIMIT 1;
  END IF;
  IF v_credit_account IS NULL OR v_payment_account IS NULL THEN
    RAISE EXCEPTION 'Customer credit liability or cash/bank account is not configured';
  END IF;

  v_entry_number:=public.get_next_sequence('journal');
  SELECT COALESCE(currency_code,'USD') INTO v_currency FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency:=COALESCE(v_currency,'USD');
  INSERT INTO public.journal_entries(entry_number,entry_date,description,source_type,source_id,currency,created_by)
  VALUES(v_entry_number,p_refunded_on,'Customer credit refund','customer_credit_refund',v_refund_id,v_currency,auth.uid())
  RETURNING id INTO v_journal_id;
  INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
  VALUES
    (v_journal_id,1,v_credit_account,'Customer credit liability settled',ROUND(p_amount,2),0),
    (v_journal_id,2,v_payment_account,'Customer refund paid',0,ROUND(p_amount,2));

  SELECT ROUND(SUM(debit),2),ROUND(SUM(credit),2) INTO v_debits,v_credits
  FROM public.journal_lines WHERE journal_entry_id=v_journal_id;
  IF v_debits<>v_credits THEN RAISE EXCEPTION 'Customer credit refund journal is not balanced'; END IF;

  UPDATE public.customer_credit_refunds SET journal_entry_id=v_journal_id WHERE id=v_refund_id;
  RETURN v_refund_id;
END;
$refund_customer_credit$;

REVOKE ALL ON FUNCTION public.refund_customer_credit(uuid,numeric,date,public.payment_method,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.refund_customer_credit(uuid,numeric,date,public.payment_method,text,uuid) TO authenticated;

-- Protect stock-return evidence once its credit-note journal exists.
CREATE OR REPLACE FUNCTION public.guard_posted_inventory_transaction_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $posted_inventory_guard_credit_note$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to change inventory records';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE source_id = OLD.id AND source_type IN ('stock_purchase','inventory_damage')
  ) OR (
    OLD.reference_type = 'invoice'
    AND EXISTS (
      SELECT 1 FROM public.journal_entries
      WHERE source_type='invoice' AND source_id=OLD.reference_id
    )
  ) OR (
    OLD.reference_type = 'credit_note'
    AND EXISTS (
      SELECT 1 FROM public.journal_entries
      WHERE source_type='credit_note' AND source_id=OLD.reference_id
    )
  ) THEN
    RAISE EXCEPTION 'An inventory transaction with a posted journal is immutable; record an audited reversal instead';
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$posted_inventory_guard_credit_note$;

REVOKE ALL ON FUNCTION public.guard_posted_inventory_transaction_mutations() FROM PUBLIC,anon,authenticated;


CREATE OR REPLACE FUNCTION public.get_customer_credit_balances(p_customer_id uuid)
RETURNS TABLE (
  credit_note_id uuid,
  credit_note_number text,
  original_invoice_id uuid,
  original_invoice_number text,
  credit_note_date date,
  reason text,
  credit_amount numeric(15,2),
  applied_amount numeric(15,2),
  refunded_amount numeric(15,2),
  remaining_amount numeric(15,2),
  can_manage boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_customer_credit_balances$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin','accountant','auditor']) THEN
    RAISE EXCEPTION 'You are not authorized to view customer credit balances';
  END IF;
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required to retrieve customer credit balances';
  END IF;

  RETURN QUERY
  SELECT
    cn.id,
    cn.credit_note_number,
    cn.invoice_id,
    i.invoice_number,
    cn.credit_note_date,
    cn.reason,
    cn.customer_credit_amount::numeric(15,2),
    COALESCE(app.applied_amount,0)::numeric(15,2),
    COALESCE(ref.refunded_amount,0)::numeric(15,2),
    GREATEST(
      cn.customer_credit_amount - COALESCE(app.applied_amount,0) - COALESCE(ref.refunded_amount,0),
      0
    )::numeric(15,2),
    public.has_any_role(ARRAY['admin','accountant'])
  FROM public.credit_notes cn
  JOIN public.invoices i ON i.id=cn.invoice_id
  LEFT JOIN (
    SELECT credit_note_id, SUM(amount) AS applied_amount
    FROM public.customer_credit_applications
    GROUP BY credit_note_id
  ) app ON app.credit_note_id=cn.id
  LEFT JOIN (
    SELECT credit_note_id, SUM(amount) AS refunded_amount
    FROM public.customer_credit_refunds
    GROUP BY credit_note_id
  ) ref ON ref.credit_note_id=cn.id
  WHERE cn.customer_id=p_customer_id
    AND cn.customer_credit_amount > 0
  ORDER BY cn.credit_note_date DESC, cn.created_at DESC;
END;
$get_customer_credit_balances$;

REVOKE ALL ON FUNCTION public.get_customer_credit_balances(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_customer_credit_balances(uuid) TO authenticated;
