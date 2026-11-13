-- Full operating-expense register with accrual recognition and controlled settlement.
-- Expenses are recognized when incurred; cash/bank payments reduce Accounts Payable.
ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'invoice'::text, 'payment'::text, 'receipt'::text, 'receipt_void'::text,
    'stock_purchase'::text, 'opening_stock_valuation'::text,
    'petty_cash_expense'::text, 'direct_invoice_cost'::text,
    'inventory_damage'::text, 'operating_expense'::text,
    'operating_expense_payment'::text
  ]));

CREATE TABLE IF NOT EXISTS public.operating_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_number text NOT NULL UNIQUE,
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  vendor_name text NOT NULL CHECK (length(btrim(vendor_name)) > 0),
  reference_number text NOT NULL CHECK (length(btrim(reference_number)) > 0),
  expense_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  incurred_on date NOT NULL,
  due_on date,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  amount_paid numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0 AND amount_paid <= amount),
  initial_amount_paid numeric(14,2) NOT NULL DEFAULT 0 CHECK (initial_amount_paid >= 0 AND initial_amount_paid <= amount),
  initial_payment_method public.payment_method,
  initial_payment_reference text,
  notes text,
  idempotency_key uuid NOT NULL UNIQUE,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_on IS NULL OR due_on >= incurred_on)
);

CREATE TABLE IF NOT EXISTS public.operating_expense_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operating_expense_id uuid NOT NULL REFERENCES public.operating_expenses(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_on date NOT NULL,
  payment_method public.payment_method NOT NULL,
  reference_number text NOT NULL CHECK (length(btrim(reference_number)) > 0),
  idempotency_key uuid NOT NULL UNIQUE,
  journal_entry_id uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operating_expenses_incurred_on_idx
  ON public.operating_expenses(incurred_on DESC);
CREATE INDEX IF NOT EXISTS operating_expenses_due_on_idx
  ON public.operating_expenses(due_on) WHERE amount_paid < amount;
CREATE INDEX IF NOT EXISTS operating_expense_payments_expense_idx
  ON public.operating_expense_payments(operating_expense_id, paid_on);

ALTER TABLE public.operating_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_expense_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY operating_expenses_finance_read
  ON public.operating_expenses FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'auditor']));
CREATE POLICY operating_expense_payments_finance_read
  ON public.operating_expense_payments FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'auditor']));
GRANT SELECT ON public.operating_expenses, public.operating_expense_payments TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_operating_expense_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $expense_immutable$
BEGIN
  IF TG_TABLE_NAME = 'operating_expenses'
     AND COALESCE(current_setting('app.expense_settlement_rpc', true), '') = 'on'
     AND NEW.id = OLD.id
     AND NEW.amount = OLD.amount
     AND NEW.description = OLD.description
     AND NEW.vendor_name = OLD.vendor_name
     AND NEW.reference_number = OLD.reference_number
     AND NEW.expense_account_id = OLD.expense_account_id
     AND NEW.incurred_on = OLD.incurred_on
     AND NEW.due_on IS NOT DISTINCT FROM OLD.due_on
     AND NEW.initial_amount_paid = OLD.initial_amount_paid
     AND NEW.amount_paid >= OLD.amount_paid
     AND NEW.amount_paid <= NEW.amount
     AND NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Posted operating expenses and payments are immutable; use a controlled reversal workflow';
END;
$expense_immutable$;

CREATE TRIGGER operating_expenses_immutable
BEFORE UPDATE OR DELETE ON public.operating_expenses
FOR EACH ROW EXECUTE FUNCTION public.guard_operating_expense_mutations();
CREATE TRIGGER operating_expense_payments_immutable
BEFORE UPDATE OR DELETE ON public.operating_expense_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_operating_expense_mutations();
REVOKE ALL ON FUNCTION public.guard_operating_expense_mutations() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pay_operating_expense(
  p_expense_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_payment_method public.payment_method,
  p_reference_number text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $pay_operating_expense$
DECLARE
  v_expense public.operating_expenses%ROWTYPE;
  v_existing public.operating_expense_payments%ROWTYPE;
  v_cash_account uuid;
  v_payable_account uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_currency text;
  v_payment_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can settle operating expenses';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_paid_on IS NULL
     OR p_payment_method IS NULL OR NULLIF(BTRIM(p_reference_number), '') IS NULL
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Enter a positive payment amount, date, method, reference and idempotency key';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_existing FROM public.operating_expense_payments
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.operating_expense_id <> p_expense_id
       OR v_existing.amount <> ROUND(p_amount, 2)
       OR v_existing.paid_on <> p_paid_on
       OR v_existing.payment_method <> p_payment_method
       OR v_existing.reference_number <> BTRIM(p_reference_number) THEN
      RAISE EXCEPTION 'This payment idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_expense FROM public.operating_expenses
  WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operating expense not found'; END IF;
  IF ROUND(p_amount, 2) > v_expense.amount - v_expense.amount_paid THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding expense balance';
  END IF;

  SELECT id INTO v_payable_account FROM public.chart_of_accounts
  WHERE code = '2000' AND account_type = 'liability' AND is_active LIMIT 1;
  IF p_payment_method = 'cash' THEN
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE code = '1000' AND account_type = 'asset' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE code = '1010' AND account_type = 'asset' AND is_active LIMIT 1;
  END IF;
  IF v_payable_account IS NULL OR v_cash_account IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable or selected cash/bank account is not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  ) VALUES (
    v_entry_number, p_paid_on,
    'Settlement - ' || v_expense.expense_number || ' - ' || v_expense.vendor_name,
    'operating_expense_payment', v_payment_id, v_currency, auth.uid()
  ) RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  ) VALUES
    (v_journal_id, 1, v_payable_account, 'Reduce payable - ' || v_expense.vendor_name, ROUND(p_amount, 2), 0),
    (v_journal_id, 2, v_cash_account, 'Expense settlement - ' || BTRIM(p_reference_number), 0, ROUND(p_amount, 2));

  INSERT INTO public.operating_expense_payments (
    operating_expense_id, amount, paid_on, payment_method, reference_number,
    idempotency_key, journal_entry_id, recorded_by
  ) VALUES (
    p_expense_id, ROUND(p_amount, 2), p_paid_on, p_payment_method, BTRIM(p_reference_number),
    p_idempotency_key, v_journal_id, auth.uid()
  ) RETURNING id INTO v_payment_id;

  PERFORM set_config('app.expense_settlement_rpc', 'on', true);
  UPDATE public.operating_expenses
  SET amount_paid = amount_paid + ROUND(p_amount, 2), updated_at = now()
  WHERE id = p_expense_id;

  RETURN v_payment_id;
END;
$pay_operating_expense$;

CREATE OR REPLACE FUNCTION public.record_operating_expense(
  p_description text,
  p_vendor_name text,
  p_reference_number text,
  p_expense_account_id uuid,
  p_incurred_on date,
  p_due_on date,
  p_amount numeric,
  p_amount_paid numeric,
  p_payment_method public.payment_method,
  p_payment_reference text,
  p_notes text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $record_operating_expense$
DECLARE
  v_existing public.operating_expenses%ROWTYPE;
  v_account public.chart_of_accounts%ROWTYPE;
  v_payable_account uuid;
  v_expense_id uuid;
  v_entry_number text;
  v_currency text;
  v_expense_number text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can record operating expenses';
  END IF;
  IF NULLIF(BTRIM(p_description), '') IS NULL OR NULLIF(BTRIM(p_vendor_name), '') IS NULL
     OR NULLIF(BTRIM(p_reference_number), '') IS NULL OR p_incurred_on IS NULL
     OR p_amount IS NULL OR p_amount <= 0 OR p_amount_paid IS NULL
     OR p_amount_paid < 0 OR p_amount_paid > p_amount OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Complete the description, supplier, source reference, date and valid amount';
  END IF;
  IF p_due_on IS NOT NULL AND p_due_on < p_incurred_on THEN
    RAISE EXCEPTION 'Due date cannot be earlier than the expense date';
  END IF;
  IF p_amount_paid > 0 AND (p_payment_method IS NULL OR NULLIF(BTRIM(p_payment_reference), '') IS NULL) THEN
    RAISE EXCEPTION 'A payment method and payment reference are required for the amount already paid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_existing FROM public.operating_expenses
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.description <> BTRIM(p_description)
       OR v_existing.vendor_name <> BTRIM(p_vendor_name)
       OR v_existing.reference_number <> BTRIM(p_reference_number)
       OR v_existing.expense_account_id <> p_expense_account_id
       OR v_existing.incurred_on <> p_incurred_on
       OR v_existing.due_on IS DISTINCT FROM p_due_on
       OR v_existing.amount <> ROUND(p_amount, 2)
       OR v_existing.initial_amount_paid <> ROUND(p_amount_paid, 2)
       OR v_existing.initial_payment_method IS DISTINCT FROM CASE WHEN p_amount_paid > 0 THEN p_payment_method ELSE NULL END
       OR v_existing.initial_payment_reference IS DISTINCT FROM CASE WHEN p_amount_paid > 0 THEN BTRIM(p_payment_reference) ELSE NULL END
       OR v_existing.notes IS DISTINCT FROM NULLIF(BTRIM(p_notes), '') THEN
      RAISE EXCEPTION 'This expense idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_account FROM public.chart_of_accounts
  WHERE id = p_expense_account_id AND account_type = 'expense' AND is_active = true
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active expense account'; END IF;
  SELECT id INTO v_payable_account FROM public.chart_of_accounts
  WHERE code = '2000' AND account_type = 'liability' AND is_active LIMIT 1;
  IF v_payable_account IS NULL THEN RAISE EXCEPTION 'Accounts Payable account is not configured'; END IF;

  v_expense_number := 'EXP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  INSERT INTO public.operating_expenses (
    expense_number, description, vendor_name, reference_number, expense_account_id,
    incurred_on, due_on, amount, amount_paid, initial_amount_paid,
    initial_payment_method, initial_payment_reference, notes, idempotency_key, recorded_by
  ) VALUES (
    v_expense_number, BTRIM(p_description), BTRIM(p_vendor_name), BTRIM(p_reference_number), p_expense_account_id,
    p_incurred_on, p_due_on, ROUND(p_amount, 2), 0, ROUND(p_amount_paid, 2),
    CASE WHEN p_amount_paid > 0 THEN p_payment_method ELSE NULL END,
    CASE WHEN p_amount_paid > 0 THEN BTRIM(p_payment_reference) ELSE NULL END,
    NULLIF(BTRIM(p_notes), ''), p_idempotency_key, auth.uid()
  ) RETURNING id INTO v_expense_id;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  ) VALUES (
    v_entry_number, p_incurred_on,
    'Operating expense - ' || BTRIM(p_vendor_name) || ' - ' || BTRIM(p_description),
    'operating_expense', v_expense_id, v_currency, auth.uid()
  ) RETURNING id INTO v_payable_account;

  -- Replace the temporary variable with the journal id; keeping all posting in this transaction.
  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  ) VALUES (
    v_payable_account, 1, p_expense_account_id, BTRIM(p_description), ROUND(p_amount, 2), 0
  ), (
    v_payable_account, 2,
    (SELECT id FROM public.chart_of_accounts WHERE code = '2000' AND account_type = 'liability' AND is_active LIMIT 1),
    'Accrued supplier payable - ' || BTRIM(p_vendor_name), 0, ROUND(p_amount, 2)
  );

  IF p_amount_paid > 0 THEN
    PERFORM public.pay_operating_expense(
      v_expense_id, p_amount_paid, p_incurred_on, p_payment_method,
      p_payment_reference, gen_random_uuid()
    );
  END IF;
  RETURN v_expense_id;
END;
$record_operating_expense$;

REVOKE ALL ON FUNCTION public.record_operating_expense(text, text, text, uuid, date, date, numeric, numeric, public.payment_method, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pay_operating_expense(uuid, numeric, date, public.payment_method, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_operating_expense(text, text, text, uuid, date, date, numeric, numeric, public.payment_method, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_operating_expense(uuid, numeric, date, public.payment_method, text, uuid) TO authenticated;

DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.operating_expenses;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.operating_expense_payments;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$publication$;

NOTIFY pgrst, 'reload schema';
