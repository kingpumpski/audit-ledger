-- Audited reversals for posted petty-cash expenses.
-- The original expense and payment evidence remain immutable; only a documented
-- cash/bank refund or correction can reverse the expense through a new journal.
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
    'operating_expense_refund'::text, 'petty_cash_expense_reversal'::text
  ]));

CREATE TABLE public.petty_cash_expense_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  petty_cash_transaction_id uuid NOT NULL UNIQUE
    REFERENCES public.petty_cash_transactions(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reversed_on date NOT NULL,
  payment_method public.payment_method NOT NULL
    CHECK (payment_method IN ('cash', 'bank_transfer', 'mobile_payment')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  reference_number text NOT NULL CHECK (length(btrim(reference_number)) > 0),
  journal_entry_id uuid NOT NULL UNIQUE
    REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL UNIQUE,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX petty_cash_expense_reversals_date_idx
  ON public.petty_cash_expense_reversals(reversed_on DESC);

ALTER TABLE public.petty_cash_expense_reversals ENABLE ROW LEVEL SECURITY;
CREATE POLICY petty_cash_expense_reversals_finance_read
  ON public.petty_cash_expense_reversals FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'auditor']));

REVOKE ALL ON TABLE public.petty_cash_expense_reversals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.petty_cash_expense_reversals TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_petty_cash_expense_reversal_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $petty_cash_reversal_immutable$
BEGIN
  RAISE EXCEPTION 'Posted petty-cash expense reversals are immutable';
END;
$petty_cash_reversal_immutable$;

CREATE TRIGGER petty_cash_expense_reversals_immutable
BEFORE UPDATE OR DELETE ON public.petty_cash_expense_reversals
FOR EACH ROW EXECUTE FUNCTION public.guard_petty_cash_expense_reversal_mutations();

REVOKE ALL ON FUNCTION public.guard_petty_cash_expense_reversal_mutations() FROM PUBLIC, anon, authenticated;

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

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_existing
  FROM public.petty_cash_expense_reversals
  WHERE idempotency_key = p_idempotency_key
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
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND OR v_expense.type <> 'expense' THEN
    RAISE EXCEPTION 'Select an existing petty-cash expense to reverse';
  END IF;

  SELECT id INTO v_original_journal
  FROM public.journal_entries
  WHERE source_type = 'petty_cash_expense' AND source_id = p_transaction_id;
  IF v_original_journal IS NULL THEN
    RAISE EXCEPTION 'The original petty-cash expense has no posted journal and cannot be reversed';
  END IF;
  IF p_reversed_on < v_expense.date THEN
    RAISE EXCEPTION 'Refund date cannot be earlier than the original petty-cash expense date';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.petty_cash_expense_reversals
    WHERE petty_cash_transaction_id = p_transaction_id
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
  WHERE code = v_account_code AND account_type = 'expense' AND is_active
  LIMIT 1;

  IF p_payment_method = 'cash' THEN
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE code = '1000' AND account_type = 'asset' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_cash_account FROM public.chart_of_accounts
    WHERE code = '1010' AND account_type = 'asset' AND is_active LIMIT 1;
  END IF;

  IF v_expense_account IS NULL OR v_cash_account IS NULL THEN
    RAISE EXCEPTION 'The original expense or selected cash/bank account is not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
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
    petty_cash_transaction_id, amount, reversed_on, payment_method,
    reason, reference_number, journal_entry_id, idempotency_key, recorded_by
  ) VALUES (
    p_transaction_id, v_amount, p_reversed_on, p_payment_method,
    BTRIM(p_reason), BTRIM(p_reference_number), v_journal_id, p_idempotency_key, auth.uid()
  ) RETURNING id INTO v_reversal_id;

  RETURN v_reversal_id;
END;
$reverse_petty_cash_expense$;

REVOKE ALL ON FUNCTION public.reverse_petty_cash_expense(uuid, date, public.payment_method, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_petty_cash_expense(uuid, date, public.payment_method, text, text, uuid) TO authenticated;

DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.petty_cash_expense_reversals;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$publication$;

NOTIFY pgrst, 'reload schema';
