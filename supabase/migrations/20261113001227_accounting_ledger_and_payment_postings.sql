-- Double-entry postings for issued invoices, tax liabilities and received payments.
-- All posting functions run atomically and are callable only by authenticated finance operators.

CREATE TABLE public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number text NOT NULL UNIQUE,
  entry_date date NOT NULL,
  description text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('invoice', 'payment')),
  source_id uuid NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_entries_source_unique UNIQUE (source_type, source_id)
);

CREATE TABLE public.journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  line_number integer NOT NULL,
  account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  description text NOT NULL,
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_lines_one_sided_amount CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  ),
  CONSTRAINT journal_lines_entry_line_unique UNIQUE (journal_entry_id, line_number)
);

CREATE INDEX journal_entries_date_idx ON public.journal_entries(entry_date DESC);
CREATE INDEX journal_entries_source_idx ON public.journal_entries(source_type, source_id);
CREATE INDEX journal_lines_account_idx ON public.journal_lines(account_id, journal_entry_id);

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.journal_entries, public.journal_lines TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.journal_entries, public.journal_lines FROM anon, authenticated;

CREATE POLICY "Finance roles can view journal entries"
ON public.journal_entries FOR SELECT TO authenticated
USING (public.has_any_role(ARRAY['admin', 'accountant', 'auditor']));

CREATE POLICY "Finance roles can view journal lines"
ON public.journal_lines FOR SELECT TO authenticated
USING (
  public.has_any_role(ARRAY['admin', 'accountant', 'auditor'])
);

-- The existing chart of accounts contains the system accounts used by the posting workflow.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code = '1100' AND account_type = 'asset' AND is_active) THEN
    RAISE EXCEPTION 'Required Accounts Receivable account (1100) is missing or inactive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code = '4000' AND account_type = 'revenue' AND is_active) THEN
    RAISE EXCEPTION 'Required Sales Revenue account (4000) is missing or inactive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code = '2100' AND account_type = 'liability' AND is_active) THEN
    RAISE EXCEPTION 'Required Sales Tax Payable account (2100) is missing or inactive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code = '1000' AND account_type = 'asset' AND is_active) THEN
    RAISE EXCEPTION 'Required Cash on Hand account (1000) is missing or inactive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code = '1010' AND account_type = 'asset' AND is_active) THEN
    RAISE EXCEPTION 'Required Bank Operating account (1010) is missing or inactive';
  END IF;
END;
$$;

ALTER TABLE public.taxes
  ADD COLUMN liability_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT;

UPDATE public.taxes
SET liability_account_id = (
  SELECT id FROM public.chart_of_accounts
  WHERE code = '2100' AND account_type = 'liability' AND is_active
  LIMIT 1
)
WHERE liability_account_id IS NULL;

ALTER TABLE public.invoice_taxes
  ADD COLUMN liability_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT;

UPDATE public.invoice_taxes it
SET liability_account_id = COALESCE(
  t.liability_account_id,
  (SELECT id FROM public.chart_of_accounts WHERE code = '2100' AND account_type = 'liability' AND is_active LIMIT 1)
)
FROM public.taxes t
WHERE t.id = it.tax_id
  AND it.liability_account_id IS NULL;

ALTER TABLE public.invoice_taxes
  ALTER COLUMN liability_account_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.set_default_tax_liability_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.liability_account_id IS NULL THEN
    SELECT id INTO NEW.liability_account_id
    FROM public.chart_of_accounts
    WHERE code = '2100' AND account_type = 'liability' AND is_active
    LIMIT 1;
  END IF;

  IF NEW.liability_account_id IS NULL THEN
    RAISE EXCEPTION 'A tax liability account is required. Configure Sales Tax Payable (2100) or select another liability account.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER set_default_tax_liability_account
BEFORE INSERT OR UPDATE OF liability_account_id ON public.taxes
FOR EACH ROW EXECUTE FUNCTION public.set_default_tax_liability_account();

CREATE OR REPLACE FUNCTION public.snapshot_invoice_tax_liability_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.liability_account_id IS NULL THEN
    SELECT liability_account_id INTO NEW.liability_account_id
    FROM public.taxes
    WHERE id = NEW.tax_id;
  END IF;

  IF NEW.liability_account_id IS NULL THEN
    SELECT id INTO NEW.liability_account_id
    FROM public.chart_of_accounts
    WHERE code = '2100' AND account_type = 'liability' AND is_active
    LIMIT 1;
  END IF;

  IF NEW.liability_account_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve a tax liability account for invoice tax snapshot';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER snapshot_invoice_tax_liability_account
BEFORE INSERT OR UPDATE OF tax_id, liability_account_id ON public.invoice_taxes
FOR EACH ROW EXECUTE FUNCTION public.snapshot_invoice_tax_liability_account();

-- Add a journal sequence for human-readable entry references.
INSERT INTO public.sequences (name, prefix, current_value, padding)
VALUES ('journal', 'JRN-', 0, 6)
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.issue_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_journal_id uuid;
  v_entry_number text;
  v_ar_account uuid;
  v_revenue_account uuid;
  v_default_tax_account uuid;
  v_currency text;
  v_tax_snapshot_total numeric(14,2) := 0;
  v_tax_total numeric(14,2) := 0;
  v_revenue_total numeric(14,2) := 0;
  v_line_number integer := 1;
  v_tax_row record;
  v_debits numeric(14,2);
  v_credits numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to issue invoices';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF v_invoice.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft invoices can be issued';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'An invoice must contain at least one line item before it can be issued';
  END IF;
  IF COALESCE(v_invoice.total_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Invoice total must be greater than zero';
  END IF;

  SELECT id INTO v_ar_account
  FROM public.chart_of_accounts
  WHERE code = '1100' AND account_type = 'asset' AND is_active
  LIMIT 1;

  SELECT id INTO v_revenue_account
  FROM public.chart_of_accounts
  WHERE code = '4000' AND account_type = 'revenue' AND is_active
  LIMIT 1;

  SELECT id INTO v_default_tax_account
  FROM public.chart_of_accounts
  WHERE code = '2100' AND account_type = 'liability' AND is_active
  LIMIT 1;

  IF v_ar_account IS NULL OR v_revenue_account IS NULL OR v_default_tax_account IS NULL THEN
    RAISE EXCEPTION 'Required system accounts are not configured';
  END IF;

  v_tax_total := ROUND(COALESCE(v_invoice.tax_amount, 0), 2);
  IF v_tax_total < 0 OR v_tax_total > ROUND(COALESCE(v_invoice.total_amount, 0), 2) THEN
    RAISE EXCEPTION 'Invoice tax total is invalid';
  END IF;
  v_revenue_total := ROUND(COALESCE(v_invoice.total_amount, 0) - v_tax_total, 2);

  UPDATE public.invoices
  SET status = 'issued',
      issued_at = now(),
      issued_by = auth.uid(),
      is_locked = true
  WHERE id = p_invoice_id;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings
  ORDER BY created_at
  LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  )
  VALUES (
    v_entry_number,
    COALESCE(v_invoice.issue_date, CURRENT_DATE),
    'Invoice ' || v_invoice.invoice_number || ' issued',
    'invoice',
    p_invoice_id,
    v_currency,
    auth.uid()
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  )
  VALUES (
    v_journal_id, v_line_number, v_ar_account,
    'Accounts receivable - ' || v_invoice.invoice_number,
    ROUND(v_invoice.total_amount, 2), 0
  );
  v_line_number := v_line_number + 1;

  IF v_revenue_total > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id, line_number, account_id, description, debit, credit
    )
    VALUES (
      v_journal_id, v_line_number, v_revenue_account,
      'Sales revenue - ' || v_invoice.invoice_number,
      0, v_revenue_total
    );
    v_line_number := v_line_number + 1;
  END IF;

  FOR v_tax_row IN
    SELECT liability_account_id, ROUND(SUM(tax_amount), 2) AS tax_amount
    FROM public.invoice_taxes
    WHERE invoice_id = p_invoice_id
    GROUP BY liability_account_id
    ORDER BY liability_account_id
  LOOP
    IF v_tax_row.tax_amount > 0 THEN
      INSERT INTO public.journal_lines (
        journal_entry_id, line_number, account_id, description, debit, credit
      )
      VALUES (
        v_journal_id, v_line_number, v_tax_row.liability_account_id,
        'Tax payable - ' || v_invoice.invoice_number,
        0, v_tax_row.tax_amount
      );
      v_line_number := v_line_number + 1;
      v_tax_snapshot_total := v_tax_snapshot_total + v_tax_row.tax_amount;
    END IF;
  END LOOP;

  -- Preserve legacy invoices that have an aggregate tax amount but no tax snapshots,
  -- and route any rounding residual to the default Sales Tax Payable account.
  IF v_tax_total - v_tax_snapshot_total > 0.01 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id, line_number, account_id, description, debit, credit
    )
    VALUES (
      v_journal_id, v_line_number, v_default_tax_account,
      'Unallocated tax payable - ' || v_invoice.invoice_number,
      0, ROUND(v_tax_total - v_tax_snapshot_total, 2)
    );
  ELSIF v_tax_snapshot_total - v_tax_total > 0.01 THEN
    RAISE EXCEPTION 'Invoice tax snapshots do not reconcile to the invoice tax total';
  END IF;

  SELECT ROUND(COALESCE(SUM(debit), 0), 2), ROUND(COALESCE(SUM(credit), 0), 2)
  INTO v_debits, v_credits
  FROM public.journal_lines
  WHERE journal_entry_id = v_journal_id;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'Invoice journal is not balanced (debits %, credits %)', v_debits, v_credits;
  END IF;

  RETURN v_journal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method public.payment_method,
  p_reference_number text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_payment_id uuid;
  v_payment_number text;
  v_journal_id uuid;
  v_entry_number text;
  v_receivable_account uuid;
  v_payment_account uuid;
  v_currency text;
  v_new_paid numeric(14,2);
  v_new_balance numeric(14,2);
  v_line_debits numeric(14,2);
  v_line_credits numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to record payments';
  END IF;

  IF p_amount IS NULL OR ROUND(p_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
    AND customer_id = p_customer_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for the selected customer';
  END IF;
  IF v_invoice.status NOT IN ('issued', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'Only issued invoices with an outstanding balance can receive payments';
  END IF;

  IF ROUND(p_amount, 2) > ROUND(COALESCE(v_invoice.balance_due, v_invoice.total_amount, 0), 2) THEN
    RAISE EXCEPTION 'Payment amount exceeds the remaining invoice balance';
  END IF;

  SELECT id INTO v_receivable_account
  FROM public.chart_of_accounts
  WHERE code = '1100' AND account_type = 'asset' AND is_active
  LIMIT 1;

  IF p_payment_method = 'cash' THEN
    SELECT id INTO v_payment_account
    FROM public.chart_of_accounts
    WHERE code = '1000' AND account_type = 'asset' AND is_active
    LIMIT 1;
  ELSE
    SELECT id INTO v_payment_account
    FROM public.chart_of_accounts
    WHERE code = '1010' AND account_type = 'asset' AND is_active
    LIMIT 1;
  END IF;

  IF v_receivable_account IS NULL OR v_payment_account IS NULL THEN
    RAISE EXCEPTION 'Required cash, bank or receivable accounts are not configured';
  END IF;

  v_payment_number := public.get_next_sequence('payment');
  INSERT INTO public.payments (
    payment_number, invoice_id, customer_id, amount, payment_method,
    reference_number, notes, processed_by, payment_date
  )
  VALUES (
    v_payment_number, p_invoice_id, p_customer_id, ROUND(p_amount, 2),
    p_payment_method, NULLIF(BTRIM(p_reference_number), ''),
    NULLIF(BTRIM(p_notes), ''), auth.uid(), now()
  )
  RETURNING id INTO v_payment_id;

  v_new_paid := ROUND(COALESCE(v_invoice.amount_paid, 0) + p_amount, 2);
  v_new_balance := GREATEST(0, ROUND(COALESCE(v_invoice.total_amount, 0) - v_new_paid, 2));

  UPDATE public.invoices
  SET amount_paid = v_new_paid,
      balance_due = v_new_balance,
      status = CASE WHEN v_new_balance <= 0 THEN 'paid'::public.invoice_status ELSE 'partially_paid'::public.invoice_status END
  WHERE id = p_invoice_id;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings
  ORDER BY created_at
  LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  )
  VALUES (
    v_entry_number, CURRENT_DATE,
    'Payment ' || v_payment_number || ' received for invoice ' || v_invoice.invoice_number,
    'payment', v_payment_id, v_currency, auth.uid()
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  )
  VALUES
    (v_journal_id, 1, v_payment_account, 'Cash/bank received - ' || v_payment_number, ROUND(p_amount, 2), 0),
    (v_journal_id, 2, v_receivable_account, 'Accounts receivable settled - ' || v_payment_number, 0, ROUND(p_amount, 2));

  SELECT ROUND(COALESCE(SUM(debit), 0), 2), ROUND(COALESCE(SUM(credit), 0), 2)
  INTO v_line_debits, v_line_credits
  FROM public.journal_lines
  WHERE journal_entry_id = v_journal_id;

  IF v_line_debits <> v_line_credits THEN
    RAISE EXCEPTION 'Payment journal is not balanced';
  END IF;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_invoice(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid, uuid, numeric, public.payment_method, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(uuid, uuid, numeric, public.payment_method, text, text) TO authenticated;
