-- Make expense idempotency keys unique within a business, not globally.
-- Existing rows retain their original business_id; all new RPC writes explicitly
-- bind their business and use business-qualified advisory locks.

ALTER TABLE public.operating_expenses
  DROP CONSTRAINT IF EXISTS operating_expenses_idempotency_key_key;
ALTER TABLE public.operating_expense_payments
  DROP CONSTRAINT IF EXISTS operating_expense_payments_idempotency_key_key;
ALTER TABLE public.operating_expense_reversals
  DROP CONSTRAINT IF EXISTS operating_expense_reversals_idempotency_key_key;
ALTER TABLE public.operating_expense_refunds
  DROP CONSTRAINT IF EXISTS operating_expense_refunds_idempotency_key_key;
ALTER TABLE public.petty_cash_expense_reversals
  DROP CONSTRAINT IF EXISTS petty_cash_expense_reversals_idempotency_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_operating_expenses_business_idempotency_key
  ON public.operating_expenses (business_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_operating_expense_payments_business_idempotency_key
  ON public.operating_expense_payments (business_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_operating_expense_reversals_business_idempotency_key
  ON public.operating_expense_reversals (business_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_operating_expense_refunds_business_idempotency_key
  ON public.operating_expense_refunds (business_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_petty_cash_expense_reversals_business_idempotency_key
  ON public.petty_cash_expense_reversals (business_id, idempotency_key);

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
  v_business_id uuid;
  v_expense public.operating_expenses%ROWTYPE;
  v_existing public.operating_expense_payments%ROWTYPE;
  v_cash_account uuid;
  v_payable_account uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_currency text;
  v_payment_id uuid := gen_random_uuid();
BEGIN
  v_business_id := public.current_business_id();
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'An active business is required';
  END IF;
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can settle operating expenses';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_paid_on IS NULL
     OR p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'bank_transfer', 'mobile_payment')
     OR NULLIF(BTRIM(p_reference_number), '') IS NULL
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Enter a positive payment amount, date, method, reference and idempotency key';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':' || p_idempotency_key::text, 0));
  SELECT * INTO v_existing FROM public.operating_expense_payments
  WHERE business_id = v_business_id AND idempotency_key = p_idempotency_key FOR UPDATE;
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
  WHERE business_id = v_business_id AND id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operating expense not found'; END IF;
  IF p_paid_on < v_expense.incurred_on THEN
    RAISE EXCEPTION 'Payment date cannot be earlier than the expense incurred date; record prepayments through the prepayment workflow';
  END IF;
  IF ROUND(p_amount, 2) > v_expense.amount - v_expense.amount_paid THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding expense balance';
  END IF;

  SELECT id INTO v_payable_account FROM public.chart_of_accounts
  WHERE business_id = v_business_id AND code = '2000' AND account_type = 'liability' AND is_active LIMIT 1;
  IF p_payment_method = 'cash' THEN
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE business_id = v_business_id AND code = '1000' AND account_type = 'asset' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE business_id = v_business_id AND code = '1010' AND account_type = 'asset' AND is_active LIMIT 1;
  END IF;
  IF v_payable_account IS NULL OR v_cash_account IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable or selected cash/bank account is not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings WHERE business_id = v_business_id ORDER BY created_at LIMIT 1;
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
    id, business_id, operating_expense_id, amount, paid_on, payment_method, reference_number,
    idempotency_key, journal_entry_id, recorded_by
  ) VALUES (
    v_payment_id, v_business_id, p_expense_id, ROUND(p_amount, 2), p_paid_on, p_payment_method, BTRIM(p_reference_number),
    p_idempotency_key, v_journal_id, auth.uid()
  ) RETURNING id INTO v_payment_id;

  PERFORM set_config('app.expense_settlement_rpc', 'on', true);
  UPDATE public.operating_expenses
  SET amount_paid = amount_paid + ROUND(p_amount, 2), updated_at = clock_timestamp()
  WHERE id = p_expense_id;
  PERFORM set_config('app.expense_settlement_rpc', 'off', true);

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
  v_business_id uuid;
  v_existing public.operating_expenses%ROWTYPE;
  v_account public.chart_of_accounts%ROWTYPE;
  v_payable_account uuid;
  v_journal_id uuid;
  v_expense_id uuid;
  v_entry_number text;
  v_currency text;
  v_expense_number text;
BEGIN
  v_business_id := public.current_business_id();
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'An active business is required';
  END IF;
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
  IF p_amount_paid > 0 AND (p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'bank_transfer', 'mobile_payment') OR NULLIF(BTRIM(p_payment_reference), '') IS NULL) THEN
    RAISE EXCEPTION 'A payment method and payment reference are required for the amount already paid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':' || p_idempotency_key::text, 0));
  SELECT * INTO v_existing FROM public.operating_expenses
  WHERE business_id = v_business_id AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.description <> BTRIM(p_description)
       OR v_existing.vendor_name <> BTRIM(p_vendor_name)
       OR v_existing.reference_number <> BTRIM(p_reference_number)
       OR v_existing.expense_account_id <> p_expense_account_id
       OR v_existing.incurred_on <> p_incurred_on
       OR v_existing.due_on IS DISTINCT FROM p_due_on
       OR v_existing.amount <> ROUND(p_amount, 2)
       OR v_existing.initial_amount_paid <> ROUND(p_amount_paid, 2)
       OR (p_amount_paid > 0 AND (
         v_existing.initial_payment_method IS DISTINCT FROM p_payment_method
         OR v_existing.initial_payment_reference IS DISTINCT FROM BTRIM(p_payment_reference)
       ))
       OR (p_amount_paid = 0 AND (
         v_existing.initial_payment_method IS NOT NULL
         OR v_existing.initial_payment_reference IS NOT NULL
       ))
       OR v_existing.notes IS DISTINCT FROM NULLIF(BTRIM(p_notes), '') THEN
      RAISE EXCEPTION 'This expense idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_account FROM public.chart_of_accounts
  WHERE business_id = v_business_id AND id = p_expense_account_id AND account_type = 'expense' AND is_active = true
    AND code NOT IN ('5000', '6500')
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active operating-expense account; Cost of Goods Sold and inventory damage must use their audited workflows'; END IF;
  SELECT id INTO v_payable_account FROM public.chart_of_accounts
  WHERE business_id = v_business_id AND code = '2000' AND account_type = 'liability' AND is_active LIMIT 1;
  IF v_payable_account IS NULL THEN RAISE EXCEPTION 'Accounts Payable account is not configured'; END IF;

  v_expense_number := 'EXP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  INSERT INTO public.operating_expenses (
    business_id, expense_number, description, vendor_name, reference_number, expense_account_id,
    incurred_on, due_on, amount, amount_paid, initial_amount_paid,
    initial_payment_method, initial_payment_reference, notes, idempotency_key, recorded_by
  ) VALUES (
    v_business_id, v_expense_number, BTRIM(p_description), BTRIM(p_vendor_name), BTRIM(p_reference_number), p_expense_account_id,
    p_incurred_on, p_due_on, ROUND(p_amount, 2), 0, ROUND(p_amount_paid, 2),
    CASE WHEN p_amount_paid > 0 THEN p_payment_method ELSE NULL END,
    CASE WHEN p_amount_paid > 0 THEN BTRIM(p_payment_reference) ELSE NULL END,
    NULLIF(BTRIM(p_notes), ''), p_idempotency_key, auth.uid()
  ) RETURNING id INTO v_expense_id;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings WHERE business_id = v_business_id ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  ) VALUES (
    v_entry_number, p_incurred_on,
    'Operating expense - ' || BTRIM(p_vendor_name) || ' - ' || BTRIM(p_description),
    'operating_expense', v_expense_id, v_currency, auth.uid()
  ) RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  ) VALUES (
    v_journal_id, 1, p_expense_account_id, BTRIM(p_description), ROUND(p_amount, 2), 0
  ), (
    v_journal_id, 2,
    (SELECT id FROM public.chart_of_accounts WHERE business_id = v_business_id AND code = '2000' AND account_type = 'liability' AND is_active LIMIT 1),
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

CREATE OR REPLACE FUNCTION public.reverse_unpaid_operating_expense(
  p_expense_id uuid,
  p_reason text,
  p_reference_number text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reverse_operating_expense$
DECLARE
  v_business_id uuid;
  v_expense public.operating_expenses%ROWTYPE;
  v_existing public.operating_expense_reversals%ROWTYPE;
  v_payable_account uuid;
  v_journal_id uuid;
  v_reversal_id uuid;
  v_entry_number text;
  v_currency text;
BEGIN
  v_business_id := public.current_business_id();
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'An active business is required';
  END IF;
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can reverse operating expenses';
  END IF;
  IF p_expense_id IS NULL OR NULLIF(BTRIM(p_reason), '') IS NULL
     OR NULLIF(BTRIM(p_reference_number), '') IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Expense, reversal reason, supporting reference and idempotency key are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':' || p_idempotency_key::text, 0));
  SELECT * INTO v_existing FROM public.operating_expense_reversals
  WHERE business_id = v_business_id AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.operating_expense_id <> p_expense_id
       OR v_existing.reason <> BTRIM(p_reason)
       OR v_existing.reference_number <> BTRIM(p_reference_number) THEN
      RAISE EXCEPTION 'This reversal idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_expense FROM public.operating_expenses
  WHERE business_id = v_business_id AND id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operating expense not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.operating_expense_reversals WHERE business_id = v_business_id AND operating_expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'This operating expense has already been reversed';
  END IF;

  SELECT id INTO v_payable_account
  FROM public.chart_of_accounts
  WHERE business_id = v_business_id AND code = '2000' AND account_type = 'liability' AND is_active
  LIMIT 1;
  IF v_payable_account IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable account is not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings WHERE business_id = v_business_id ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  ) VALUES (
    v_entry_number, CURRENT_DATE,
    'Reversal of operating expense ' || v_expense.expense_number || ': ' || BTRIM(p_reason),
    'operating_expense_reversal', p_expense_id, v_currency, auth.uid()
  ) RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  ) VALUES
    (v_journal_id, 1, v_payable_account, 'Reverse supplier payable - ' || v_expense.vendor_name, v_expense.amount, 0),
    (v_journal_id, 2, v_expense.expense_account_id, 'Reverse expense - ' || v_expense.description, 0, v_expense.amount);

  INSERT INTO public.operating_expense_reversals (
    business_id, operating_expense_id, amount, reason, reference_number,
    journal_entry_id, idempotency_key, recorded_by
  ) VALUES (
    v_business_id, p_expense_id, v_expense.amount, BTRIM(p_reason), BTRIM(p_reference_number),
    v_journal_id, p_idempotency_key, auth.uid()
  ) RETURNING id INTO v_reversal_id;

  RETURN v_reversal_id;
END;
$reverse_operating_expense$;

CREATE OR REPLACE FUNCTION public.record_operating_expense_refund(
  p_expense_id uuid,
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
AS $record_expense_refund$
DECLARE
  v_business_id uuid;
  v_expense public.operating_expenses%ROWTYPE;
  v_existing public.operating_expense_refunds%ROWTYPE;
  v_refunded numeric(14,2);
  v_cash_account uuid;
  v_payable_account uuid;
  v_journal_id uuid;
  v_refund_id uuid := gen_random_uuid();
  v_entry_number text;
  v_currency text;
BEGIN
  v_business_id := public.current_business_id();
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'An active business is required';
  END IF;
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can record supplier refunds';
  END IF;
  IF p_expense_id IS NULL OR p_amount IS NULL OR p_amount <= 0
     OR p_refunded_on IS NULL OR p_payment_method IS NULL
     OR p_payment_method NOT IN ('cash', 'bank_transfer', 'mobile_payment')
     OR NULLIF(BTRIM(p_reference_number), '') IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Enter a positive refund, date, cash/bank method, supplier refund reference and idempotency key';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':' || p_idempotency_key::text, 0));
  SELECT * INTO v_existing FROM public.operating_expense_refunds
  WHERE business_id = v_business_id AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.operating_expense_id <> p_expense_id
       OR v_existing.amount <> ROUND(p_amount, 2)
       OR v_existing.refunded_on <> p_refunded_on
       OR v_existing.payment_method <> p_payment_method
       OR v_existing.reference_number <> BTRIM(p_reference_number) THEN
      RAISE EXCEPTION 'This refund idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_expense FROM public.operating_expenses
  WHERE business_id = v_business_id AND id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operating expense not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.operating_expense_reversals WHERE business_id = v_business_id AND operating_expense_id = p_expense_id
  ) THEN
    RAISE EXCEPTION 'Reverse the supplier expense with approval evidence before recording its refund';
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_refunded
  FROM public.operating_expense_refunds WHERE business_id = v_business_id AND operating_expense_id = p_expense_id;
  IF ROUND(p_amount, 2) > v_expense.amount_paid - v_refunded THEN
    RAISE EXCEPTION 'Refund exceeds the amount actually paid to the supplier and not yet refunded';
  END IF;
  IF p_refunded_on < COALESCE(
    (SELECT max(paid_on) FROM public.operating_expense_payments WHERE business_id = v_business_id AND operating_expense_id = p_expense_id),
    v_expense.incurred_on
  ) THEN
    RAISE EXCEPTION 'Supplier refund date cannot be earlier than the latest supplier payment';
  END IF;

  SELECT id INTO v_payable_account
  FROM public.chart_of_accounts
  WHERE business_id = v_business_id AND code = '2000' AND account_type = 'liability' AND is_active LIMIT 1;
  IF p_payment_method = 'cash' THEN
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE business_id = v_business_id AND code = '1000' AND account_type = 'asset' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE business_id = v_business_id AND code = '1010' AND account_type = 'asset' AND is_active LIMIT 1;
  END IF;
  IF v_payable_account IS NULL OR v_cash_account IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable or selected Cash/Bank account is not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings WHERE business_id = v_business_id ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  ) VALUES (
    v_entry_number, p_refunded_on,
    'Supplier refund - ' || v_expense.expense_number || ' - ' || BTRIM(p_reference_number),
    'operating_expense_refund', v_refund_id, v_currency, auth.uid()
  ) RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  ) VALUES
    (v_journal_id, 1, v_cash_account, 'Supplier refund received - ' || v_expense.vendor_name, ROUND(p_amount, 2), 0),
    (v_journal_id, 2, v_payable_account, 'Clear supplier refund receivable - ' || v_expense.vendor_name, 0, ROUND(p_amount, 2));

  INSERT INTO public.operating_expense_refunds (
    id, business_id, operating_expense_id, amount, refunded_on, payment_method, reference_number,
    idempotency_key, journal_entry_id, recorded_by
  ) VALUES (
    v_refund_id, v_business_id, p_expense_id, ROUND(p_amount, 2), p_refunded_on, p_payment_method,
    BTRIM(p_reference_number), p_idempotency_key, v_journal_id, auth.uid()
  );

  RETURN v_refund_id;
END;
$record_expense_refund$;

CREATE OR REPLACE FUNCTION public.reverse_petty_cash_expense(
  p_transaction_id uuid,
  p_reversed_on date,
  p_payment_method public.payment_method,
  p_reason text,
  p_reference_number text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reverse_petty_cash_expense$
DECLARE
  v_business_id uuid;
  v_expense public.petty_cash_transactions%ROWTYPE;
  v_existing public.petty_cash_expense_reversals%ROWTYPE;
  v_original_journal uuid;
  v_expense_account uuid;
  v_cash_account uuid;
  v_journal_id uuid;
  v_reversal_id uuid;
  v_entry_number text;
  v_currency text;
  v_account_code text;
  v_amount numeric(14,2);
BEGIN
  v_business_id := public.current_business_id();
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'An active business is required';
  END IF;
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can reverse petty-cash expenses';
  END IF;
  IF p_transaction_id IS NULL OR p_reversed_on IS NULL
     OR p_payment_method IS NULL
     OR p_payment_method NOT IN ('cash', 'bank_transfer', 'mobile_payment')
     OR NULLIF(BTRIM(p_reason), '') IS NULL
     OR NULLIF(BTRIM(p_reference_number), '') IS NULL
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Expense, refund date, payment method, reason, supporting reference and idempotency key are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':' || p_idempotency_key::text, 0));
  SELECT * INTO v_existing
  FROM public.petty_cash_expense_reversals
  WHERE business_id = v_business_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.petty_cash_transaction_id <> p_transaction_id
       OR v_existing.reversed_on <> p_reversed_on
       OR v_existing.payment_method <> p_payment_method
       OR v_existing.reason <> BTRIM(p_reason)
       OR v_existing.reference_number <> BTRIM(p_reference_number) THEN
      RAISE EXCEPTION 'This petty-cash reversal idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_expense
  FROM public.petty_cash_transactions
  WHERE business_id = v_business_id AND id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND OR v_expense.type <> 'expense' THEN
    RAISE EXCEPTION 'Select an existing petty-cash expense to reverse';
  END IF;

  SELECT id INTO v_original_journal
  FROM public.journal_entries
  WHERE business_id = v_business_id AND source_type = 'petty_cash_expense' AND source_id = p_transaction_id;
  IF v_original_journal IS NULL THEN
    RAISE EXCEPTION 'The original petty-cash expense has no posted journal and cannot be reversed';
  END IF;
  IF p_reversed_on < v_expense.date THEN
    RAISE EXCEPTION 'Refund date cannot be earlier than the original petty-cash expense date';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.petty_cash_expense_reversals
    WHERE business_id = v_business_id AND petty_cash_transaction_id = p_transaction_id
  ) THEN
    RAISE EXCEPTION 'This petty-cash expense has already been reversed';
  END IF;

  v_amount := ROUND(v_expense.amount, 2);
  v_account_code := CASE
    WHEN lower(COALESCE(v_expense.category, '')) ~ '(salary|wage|payroll)' THEN '6100'
    WHEN lower(COALESCE(v_expense.category, '')) ~ '(rent|lease)' THEN '6200'
    WHEN lower(COALESCE(v_expense.category, '')) ~ '(utility|electric|water|internet)' THEN '6300'
    ELSE '6000'
  END;

  SELECT id INTO v_expense_account
  FROM public.chart_of_accounts
  WHERE business_id = v_business_id AND code = v_account_code AND account_type = 'expense' AND is_active
  LIMIT 1;

  IF p_payment_method = 'cash' THEN
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE business_id = v_business_id AND code = '1000' AND account_type = 'asset' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE business_id = v_business_id AND code = '1010' AND account_type = 'asset' AND is_active LIMIT 1;
  END IF;

  IF v_expense_account IS NULL OR v_cash_account IS NULL THEN
    RAISE EXCEPTION 'The original expense or selected cash/bank account is not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings WHERE business_id = v_business_id ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  ) VALUES (
    v_entry_number, p_reversed_on,
    'Reversal of petty-cash expense - ' || v_expense.description || ': ' || BTRIM(p_reason),
    'petty_cash_expense_reversal', p_transaction_id, v_currency, auth.uid()
  ) RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  ) VALUES
    (v_journal_id, 1, v_cash_account, 'Cash/bank refund received - ' || v_expense.description, v_amount, 0),
    (v_journal_id, 2, v_expense_account, 'Reverse petty-cash expense - ' || v_expense.description, 0, v_amount);

  INSERT INTO public.petty_cash_expense_reversals (
    business_id, petty_cash_transaction_id, amount, reversed_on, payment_method,
    reason, reference_number, journal_entry_id, idempotency_key, recorded_by
  ) VALUES (
    v_business_id, p_transaction_id, v_amount, p_reversed_on, p_payment_method,
    BTRIM(p_reason), BTRIM(p_reference_number), v_journal_id, p_idempotency_key, auth.uid()
  ) RETURNING id INTO v_reversal_id;

  RETURN v_reversal_id;
END;
$reverse_petty_cash_expense$;

NOTIFY pgrst, 'reload schema';
