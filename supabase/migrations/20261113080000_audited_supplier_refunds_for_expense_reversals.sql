-- Supplier refunds complete the controlled reversal path for partially or fully paid operating expenses.
-- Reversal recognizes the full supplier credit; actual cash/bank refunds are separate, evidenced postings.

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
    'operating_expense_refund'::text
  ]));

CREATE TABLE public.operating_expense_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operating_expense_id uuid NOT NULL REFERENCES public.operating_expenses(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  refunded_on date NOT NULL,
  payment_method public.payment_method NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'mobile_payment')),
  reference_number text NOT NULL CHECK (length(btrim(reference_number)) > 0),
  idempotency_key uuid NOT NULL UNIQUE,
  journal_entry_id uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX operating_expense_refunds_expense_idx
  ON public.operating_expense_refunds(operating_expense_id, refunded_on);

ALTER TABLE public.operating_expense_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY operating_expense_refunds_finance_read
  ON public.operating_expense_refunds FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'auditor']));
REVOKE ALL ON TABLE public.operating_expense_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.operating_expense_refunds TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_operating_expense_refund_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $expense_refund_immutable$
BEGIN
  RAISE EXCEPTION 'Posted supplier refunds are immutable; record a separately approved correction';
END;
$expense_refund_immutable$;

CREATE TRIGGER operating_expense_refunds_immutable
BEFORE UPDATE OR DELETE ON public.operating_expense_refunds
FOR EACH ROW EXECUTE FUNCTION public.guard_operating_expense_refund_mutations();
REVOKE ALL ON FUNCTION public.guard_operating_expense_refund_mutations() FROM PUBLIC, anon, authenticated;

-- The expense reversal always reverses the full accrual (Dr AP / Cr expense).
-- If amounts were paid, AP becomes a debit balance until supplier cash is actually refunded.
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
  v_expense public.operating_expenses%ROWTYPE;
  v_existing public.operating_expense_reversals%ROWTYPE;
  v_payable_account uuid;
  v_journal_id uuid;
  v_reversal_id uuid;
  v_entry_number text;
  v_currency text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can reverse operating expenses';
  END IF;
  IF p_expense_id IS NULL OR NULLIF(BTRIM(p_reason), '') IS NULL
     OR NULLIF(BTRIM(p_reference_number), '') IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Expense, reversal reason, supporting reference and idempotency key are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_existing FROM public.operating_expense_reversals
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.operating_expense_id <> p_expense_id
       OR v_existing.reason <> BTRIM(p_reason)
       OR v_existing.reference_number <> BTRIM(p_reference_number) THEN
      RAISE EXCEPTION 'This reversal idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_expense FROM public.operating_expenses
  WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operating expense not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.operating_expense_reversals WHERE operating_expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'This operating expense has already been reversed';
  END IF;

  SELECT id INTO v_payable_account
  FROM public.chart_of_accounts
  WHERE code = '2000' AND account_type = 'liability' AND is_active
  LIMIT 1;
  IF v_payable_account IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable account is not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
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
    operating_expense_id, amount, reason, reference_number,
    journal_entry_id, idempotency_key, recorded_by
  ) VALUES (
    p_expense_id, v_expense.amount, BTRIM(p_reason), BTRIM(p_reference_number),
    v_journal_id, p_idempotency_key, auth.uid()
  ) RETURNING id INTO v_reversal_id;

  RETURN v_reversal_id;
END;
$reverse_operating_expense$;

REVOKE ALL ON FUNCTION public.reverse_unpaid_operating_expense(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_unpaid_operating_expense(uuid, text, text, uuid) TO authenticated;

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
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can record supplier refunds';
  END IF;
  IF p_expense_id IS NULL OR p_amount IS NULL OR p_amount <= 0
     OR p_refunded_on IS NULL OR p_payment_method IS NULL
     OR p_payment_method NOT IN ('cash', 'bank_transfer', 'mobile_payment')
     OR NULLIF(BTRIM(p_reference_number), '') IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Enter a positive refund, date, cash/bank method, supplier refund reference and idempotency key';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_existing FROM public.operating_expense_refunds
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
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
  WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operating expense not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.operating_expense_reversals WHERE operating_expense_id = p_expense_id
  ) THEN
    RAISE EXCEPTION 'Reverse the supplier expense with approval evidence before recording its refund';
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_refunded
  FROM public.operating_expense_refunds WHERE operating_expense_id = p_expense_id;
  IF ROUND(p_amount, 2) > v_expense.amount_paid - v_refunded THEN
    RAISE EXCEPTION 'Refund exceeds the amount actually paid to the supplier and not yet refunded';
  END IF;
  IF p_refunded_on < v_expense.incurred_on THEN
    RAISE EXCEPTION 'Supplier refund date cannot be earlier than the expense incurred date';
  END IF;

  SELECT id INTO v_payable_account
  FROM public.chart_of_accounts
  WHERE code = '2000' AND account_type = 'liability' AND is_active LIMIT 1;
  IF p_payment_method = 'cash' THEN
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE code = '1000' AND account_type = 'asset' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE code = '1010' AND account_type = 'asset' AND is_active LIMIT 1;
  END IF;
  IF v_payable_account IS NULL OR v_cash_account IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable or selected Cash/Bank account is not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
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
    id, operating_expense_id, amount, refunded_on, payment_method, reference_number,
    idempotency_key, journal_entry_id, recorded_by
  ) VALUES (
    v_refund_id, p_expense_id, ROUND(p_amount, 2), p_refunded_on, p_payment_method,
    BTRIM(p_reference_number), p_idempotency_key, v_journal_id, auth.uid()
  );

  RETURN v_refund_id;
END;
$record_expense_refund$;

REVOKE ALL ON FUNCTION public.record_operating_expense_refund(uuid, numeric, date, public.payment_method, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_operating_expense_refund(uuid, numeric, date, public.payment_method, text, uuid) TO authenticated;

DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.operating_expense_refunds;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$publication$;

NOTIFY pgrst, 'reload schema';
