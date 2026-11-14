-- Separate non-cash settlement clearing accounts and date-accurate customer receivables.
-- This migration is additive and is intended for the isolated PR migration replay first.

INSERT INTO public.chart_of_accounts
  (code, name, description, account_type, account_subtype, is_system, is_active)
VALUES
  ('1020','Card Settlement Clearing','Amounts received by card processors but not yet settled to the operating bank account.','asset','current_asset',true,true),
  ('1030','Mobile Money Clearing','Mobile money receipts awaiting settlement to the operating bank account.','asset','current_asset',true,true),
  ('1040','Undeposited Cheques','Cheques received but not yet deposited and cleared into the operating bank account.','asset','current_asset',true,true),
  ('6400','Merchant & Settlement Fees','Card processor and mobile-money settlement fees.','expense','operating_expense',true,true)
ON CONFLICT (code) DO NOTHING;

DO $clearing_account_validation$
DECLARE
  v_code text;
BEGIN
  FOREACH v_code IN ARRAY ARRAY['1020','1030','1040'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.chart_of_accounts
      WHERE code=v_code AND account_type='asset' AND is_active AND is_system
    ) THEN
      RAISE EXCEPTION 'Required active system clearing account % is missing or incorrectly configured',v_code;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
    WHERE code='6400' AND account_type='expense' AND is_active AND is_system
  ) THEN
    RAISE EXCEPTION 'Required active merchant fee expense account 6400 is missing or incorrectly configured';
  END IF;
END;
$clearing_account_validation$;

CREATE OR REPLACE FUNCTION public.resolve_payment_account_id(p_payment_method public.payment_method)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $resolve_payment_account$
DECLARE
  v_code text;
  v_account_id uuid;
BEGIN
  v_code := CASE p_payment_method
    WHEN 'cash' THEN '1000'
    WHEN 'bank_transfer' THEN '1010'
    WHEN 'credit_card' THEN '1020'
    WHEN 'debit_card' THEN '1020'
    WHEN 'mobile_payment' THEN '1030'
    WHEN 'check' THEN '1040'
    WHEN 'other' THEN NULL
    ELSE NULL
  END;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Payment method % has no configured ledger account; select a supported method or configure an account mapping',p_payment_method;
  END IF;

  SELECT id INTO v_account_id
  FROM public.chart_of_accounts
  WHERE code=v_code AND account_type='asset' AND is_active=true
  LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'The ledger account % required for payment method % is not configured or active',v_code,p_payment_method;
  END IF;

  RETURN v_account_id;
END;
$resolve_payment_account$;

REVOKE ALL ON FUNCTION public.resolve_payment_account_id(public.payment_method) FROM PUBLIC,anon,authenticated;

-- Invoice-linked receipts/payments debit the correct settlement account.
CREATE OR REPLACE FUNCTION public.apply_invoice_payment_and_post_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $apply_payment_clearing$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_entry_number text;
  v_journal_id uuid;
  v_receivable_account uuid;
  v_payment_account uuid;
  v_currency text;
  v_new_paid numeric(14,2);
  v_new_balance numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin','accountant','cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to post invoice payments';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id=NEW.invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found while posting payment'; END IF;
  IF NEW.customer_id IS DISTINCT FROM v_invoice.customer_id THEN
    RAISE EXCEPTION 'Payment customer does not match the invoice customer';
  END IF;
  IF NEW.amount IS NULL OR NEW.amount<=0 OR NEW.amount<>ROUND(NEW.amount,2) THEN
    RAISE EXCEPTION 'Payment amount must be positive and have at most two decimal places';
  END IF;

  v_new_paid := ROUND(COALESCE(v_invoice.amount_paid,0)+NEW.amount,2);
  v_new_balance := GREATEST(0,ROUND(COALESCE(v_invoice.total_amount,0)-v_new_paid,2));
  IF NEW.amount > COALESCE(v_invoice.balance_due,0) THEN
    RAISE EXCEPTION 'Payment exceeds the invoice balance due';
  END IF;

  UPDATE public.invoices
  SET amount_paid=v_new_paid,
      balance_due=v_new_balance,
      status=CASE WHEN v_new_balance<=0 THEN 'paid'::public.invoice_status ELSE 'partially_paid'::public.invoice_status END
  WHERE id=NEW.invoice_id;

  SELECT id INTO v_receivable_account
  FROM public.chart_of_accounts
  WHERE code='1100' AND account_type='asset' AND is_active LIMIT 1;
  v_payment_account := public.resolve_payment_account_id(NEW.payment_method);

  IF v_receivable_account IS NULL THEN
    RAISE EXCEPTION 'Accounts receivable account 1100 is not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code,'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency,'USD');

  INSERT INTO public.journal_entries(entry_number,entry_date,description,source_type,source_id,currency,created_by)
  VALUES(v_entry_number,COALESCE(NEW.payment_date::date,CURRENT_DATE),
    'Payment '||NEW.payment_number||' received for invoice '||v_invoice.invoice_number,
    'payment',NEW.id,v_currency,auth.uid())
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
  VALUES
    (v_journal_id,1,v_payment_account,'Funds received - '||NEW.payment_number,ROUND(NEW.amount,2),0),
    (v_journal_id,2,v_receivable_account,'Accounts receivable settled - '||NEW.payment_number,0,ROUND(NEW.amount,2));

  RETURN NEW;
END;
$apply_payment_clearing$;

REVOKE ALL ON FUNCTION public.apply_invoice_payment_and_post_journal() FROM PUBLIC,anon,authenticated;

-- Standalone and legacy unlinked receipts use the same payment-method mapping.
CREATE OR REPLACE FUNCTION public.post_receipt_journal_by_id(p_receipt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $post_receipt_clearing$
DECLARE
  v_receipt public.receipts%ROWTYPE;
  v_payment_account uuid;
  v_credit_account uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_currency text;
  v_customer_name text;
  v_credit_description text;
BEGIN
  SELECT * INTO v_receipt FROM public.receipts WHERE id=p_receipt_id;
  IF NOT FOUND OR v_receipt.status<>'issued' OR v_receipt.payment_id IS NOT NULL THEN RETURN; END IF;

  v_payment_account := public.resolve_payment_account_id(v_receipt.payment_method);

  IF v_receipt.invoice_id IS NOT NULL THEN
    SELECT id INTO v_credit_account FROM public.chart_of_accounts
    WHERE code='1100' AND account_type='asset' AND is_active LIMIT 1;
    v_credit_description := 'Accounts receivable settled - '||v_receipt.receipt_number;
  ELSE
    SELECT id INTO v_credit_account FROM public.chart_of_accounts
    WHERE code='2200' AND account_type='liability' AND is_active LIMIT 1;
    v_credit_description := 'Customer deposits / unapplied receipts - '||v_receipt.receipt_number;
  END IF;

  IF v_payment_account IS NULL OR v_credit_account IS NULL THEN
    RAISE EXCEPTION 'Required payment, receivable or customer-deposit account is not configured';
  END IF;
  IF EXISTS(SELECT 1 FROM public.journal_entries WHERE source_type='receipt' AND source_id=v_receipt.id) THEN RETURN; END IF;

  SELECT name INTO v_customer_name FROM public.customers WHERE id=v_receipt.customer_id;
  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code,'USD') INTO v_currency FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency,'USD');

  INSERT INTO public.journal_entries(entry_number,entry_date,description,source_type,source_id,currency,created_by)
  VALUES(v_entry_number,COALESCE(v_receipt.issue_date::date,CURRENT_DATE),
    CASE WHEN v_receipt.invoice_id IS NOT NULL
      THEN 'Direct receipt '||v_receipt.receipt_number||' received from '||COALESCE(v_customer_name,'customer')
      ELSE 'Unapplied receipt '||v_receipt.receipt_number||' received from '||COALESCE(v_customer_name,'customer') END,
    'receipt',v_receipt.id,v_currency,v_receipt.issued_by)
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
  VALUES
    (v_journal_id,1,v_payment_account,'Funds received - '||v_receipt.receipt_number,ROUND(v_receipt.amount,2),0),
    (v_journal_id,2,v_credit_account,v_credit_description,0,ROUND(v_receipt.amount,2));
END;
$post_receipt_clearing$;

REVOKE ALL ON FUNCTION public.post_receipt_journal_by_id(uuid) FROM PUBLIC,anon,authenticated;

-- Immutable evidence for clearing-account settlements and processor fees.
CREATE TABLE public.payment_clearing_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clearing_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  gross_amount numeric(15,2) NOT NULL CHECK(gross_amount>0),
  fee_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK(fee_amount>=0 AND fee_amount<=gross_amount),
  net_amount numeric(15,2) GENERATED ALWAYS AS (gross_amount-fee_amount) STORED,
  settled_on date NOT NULL,
  provider_reference text NOT NULL CHECK(length(btrim(provider_reference))>0),
  bank_reference text NOT NULL CHECK(length(btrim(bank_reference))>0),
  notes text,
  idempotency_key uuid NOT NULL UNIQUE,
  request_fingerprint text NOT NULL CHECK(length(request_fingerprint)=32),
  journal_entry_id uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_clearing_settlements_account_date_idx
  ON public.payment_clearing_settlements(clearing_account_id,settled_on DESC);

ALTER TABLE public.payment_clearing_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_clearing_settlements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.payment_clearing_settlements TO authenticated;
CREATE POLICY payment_clearing_settlements_finance_read
  ON public.payment_clearing_settlements FOR SELECT TO authenticated
  USING(public.has_any_role(ARRAY['admin','accountant','auditor']));

CREATE OR REPLACE FUNCTION public.guard_payment_clearing_settlement_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $clearing_immutable$
BEGIN
  RAISE EXCEPTION 'Payment clearing settlements are immutable; record an audited correction instead';
END;
$clearing_immutable$;

CREATE TRIGGER payment_clearing_settlements_immutable
BEFORE UPDATE OR DELETE ON public.payment_clearing_settlements
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_clearing_settlement_mutations();
REVOKE ALL ON FUNCTION public.guard_payment_clearing_settlement_mutations() FROM PUBLIC,anon,authenticated;

ALTER TABLE public.journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_source_type_check
CHECK(source_type=ANY(ARRAY[
  'invoice','payment','receipt','receipt_void','stock_purchase','opening_stock_valuation',
  'petty_cash_expense','direct_invoice_cost','inventory_damage','operating_expense',
  'operating_expense_payment','operating_expense_reversal','operating_expense_refund',
  'petty_cash_expense_reversal','inventory_count_adjustment','stock_purchase_reversal',
  'credit_note','customer_credit_application','customer_credit_refund','payment_clearing_settlement'
]::text[]));

CREATE OR REPLACE FUNCTION public.settle_payment_clearing_account(
  p_clearing_account_code text,
  p_gross_amount numeric,
  p_fee_amount numeric,
  p_settled_on date,
  p_provider_reference text,
  p_bank_reference text,
  p_idempotency_key uuid,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $settle_payment_clearing$
DECLARE
  v_user uuid := auth.uid();
  v_account_id uuid;
  v_bank_account uuid;
  v_fee_account uuid;
  v_settlement_id uuid := gen_random_uuid();
  v_journal_id uuid;
  v_entry_number text;
  v_currency text;
  v_available numeric(15,2);
  v_net numeric(15,2);
  v_fingerprint text;
  v_existing public.payment_clearing_settlements%ROWTYPE;
BEGIN
  IF v_user IS NULL OR NOT public.has_any_role(ARRAY['admin','accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can settle payment clearing accounts';
  END IF;
  IF p_clearing_account_code NOT IN ('1020','1030','1040') THEN
    RAISE EXCEPTION 'Choose a card, mobile-money or cheque clearing account';
  END IF;
  IF p_gross_amount IS NULL OR p_gross_amount<=0 OR p_gross_amount<>ROUND(p_gross_amount,2)
     OR p_fee_amount IS NULL OR p_fee_amount<0 OR p_fee_amount<>ROUND(p_fee_amount,2)
     OR p_fee_amount>p_gross_amount OR p_settled_on IS NULL OR p_settled_on>CURRENT_DATE
     OR NULLIF(BTRIM(p_provider_reference),'') IS NULL
     OR NULLIF(BTRIM(p_bank_reference),'') IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Enter valid gross amount, fees, settlement date and both settlement references';
  END IF;

  v_fingerprint := md5(concat_ws('|',p_clearing_account_code,p_gross_amount,p_fee_amount,p_settled_on,
    BTRIM(p_provider_reference),BTRIM(p_bank_reference),COALESCE(BTRIM(p_notes),'')));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  SELECT * INTO v_existing FROM public.payment_clearing_settlements
  WHERE idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_fingerprint<>v_fingerprint OR v_existing.created_by<>v_user THEN
      RAISE EXCEPTION 'This settlement idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT id INTO v_account_id FROM public.chart_of_accounts
  WHERE code=p_clearing_account_code AND account_type='asset' AND is_active FOR UPDATE;
  SELECT id INTO v_bank_account FROM public.chart_of_accounts
  WHERE code='1010' AND account_type='asset' AND is_active;
  SELECT id INTO v_fee_account FROM public.chart_of_accounts
  WHERE code='6400' AND account_type='expense' AND is_active;
  IF v_account_id IS NULL OR v_bank_account IS NULL OR v_fee_account IS NULL THEN
    RAISE EXCEPTION 'Clearing, bank or merchant-fee account is not configured';
  END IF;

  SELECT ROUND(COALESCE(SUM(jl.debit-jl.credit),0),2) INTO v_available
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id=jl.journal_entry_id
  WHERE jl.account_id=v_account_id AND je.entry_date<=p_settled_on;
  IF p_gross_amount>v_available THEN
    RAISE EXCEPTION 'Settlement exceeds the clearing balance available on % (available %)',p_settled_on,v_available;
  END IF;

  v_net := ROUND(p_gross_amount-p_fee_amount,2);
  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code,'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency,'USD');

  INSERT INTO public.journal_entries(entry_number,entry_date,description,source_type,source_id,currency,created_by)
  VALUES(v_entry_number,p_settled_on,'Settlement of clearing account '||p_clearing_account_code||
    ' - '||BTRIM(p_provider_reference),'payment_clearing_settlement',v_settlement_id,v_currency,v_user)
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
  VALUES (v_journal_id,1,v_bank_account,'Net settlement received - '||BTRIM(p_bank_reference),v_net,0);
  IF p_fee_amount>0 THEN
    INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
    VALUES (v_journal_id,2,v_fee_account,'Payment processor / settlement fees',p_fee_amount,0);
  END IF;
  INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
  VALUES (v_journal_id,CASE WHEN p_fee_amount>0 THEN 3 ELSE 2 END,v_account_id,
    'Clearing balance settled - '||BTRIM(p_provider_reference),0,p_gross_amount);

  INSERT INTO public.payment_clearing_settlements(
    id,clearing_account_id,gross_amount,fee_amount,settled_on,provider_reference,bank_reference,
    notes,idempotency_key,request_fingerprint,journal_entry_id,created_by
  ) VALUES (
    v_settlement_id,v_account_id,p_gross_amount,p_fee_amount,p_settled_on,
    BTRIM(p_provider_reference),BTRIM(p_bank_reference),NULLIF(BTRIM(p_notes),''),
    p_idempotency_key,v_fingerprint,v_journal_id,v_user
  );

  RETURN v_settlement_id;
END;
$settle_payment_clearing$;

REVOKE ALL ON FUNCTION public.settle_payment_clearing_account(text,numeric,numeric,date,text,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.settle_payment_clearing_account(text,numeric,numeric,date,text,text,uuid,text) TO authenticated;

-- Date-driven customer receivables. This deliberately derives balances from
-- invoice, payment, credit-note and credit-application dates, not customers.current_balance.
CREATE OR REPLACE FUNCTION public.get_customer_account_balances(
  p_as_of_date date DEFAULT CURRENT_DATE,
  p_customer_id uuid DEFAULT NULL
)
RETURNS TABLE(
  customer_id uuid,
  customer_code text,
  customer_name text,
  invoiced_amount numeric(15,2),
  payments_received numeric(15,2),
  credit_notes_applied numeric(15,2),
  customer_credits_applied numeric(15,2),
  outstanding_balance numeric(15,2),
  as_of_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $customer_account_balances$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin','accountant','auditor','cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to view customer account balances';
  END IF;
  IF p_as_of_date IS NULL THEN RAISE EXCEPTION 'An as-at date is required'; END IF;

  RETURN QUERY
  WITH issued_invoices AS (
    SELECT i.id,i.customer_id,i.issue_date,ROUND(COALESCE(i.total_amount,0),2) AS total_amount
    FROM public.invoices i
    WHERE i.deleted_at IS NULL
      AND i.status IN ('issued','partially_paid','paid','overdue')
      AND i.issue_date<=p_as_of_date
      AND (p_customer_id IS NULL OR i.customer_id=p_customer_id)
  ),
  invoice_payments AS (
    SELECT p.invoice_id,ROUND(SUM(p.amount),2) AS amount
    FROM public.payments p
    JOIN issued_invoices i ON i.id=p.invoice_id
    WHERE p.deleted_at IS NULL AND p.payment_date::date<=p_as_of_date
    GROUP BY p.invoice_id
  ),
  invoice_credit_notes AS (
    SELECT cn.invoice_id,ROUND(SUM(cn.receivable_applied),2) AS amount
    FROM public.credit_notes cn
    JOIN issued_invoices i ON i.id=cn.invoice_id
    WHERE cn.credit_note_date<=p_as_of_date
    GROUP BY cn.invoice_id
  ),
  invoice_credit_applications AS (
    SELECT cca.applied_to_invoice_id AS invoice_id,ROUND(SUM(cca.amount),2) AS amount
    FROM public.customer_credit_applications cca
    JOIN issued_invoices i ON i.id=cca.applied_to_invoice_id
    WHERE cca.applied_on<=p_as_of_date
    GROUP BY cca.applied_to_invoice_id
  ),
  invoice_balances AS (
    SELECT i.customer_id,i.total_amount,
      COALESCE(p.amount,0) AS paid_amount,
      COALESCE(cn.amount,0) AS credit_note_amount,
      COALESCE(ca.amount,0) AS credit_application_amount,
      GREATEST(0,ROUND(i.total_amount-COALESCE(p.amount,0)-COALESCE(cn.amount,0)-COALESCE(ca.amount,0),2)) AS balance
    FROM issued_invoices i
    LEFT JOIN invoice_payments p ON p.invoice_id=i.id
    LEFT JOIN invoice_credit_notes cn ON cn.invoice_id=i.id
    LEFT JOIN invoice_credit_applications ca ON ca.invoice_id=i.id
  )
  SELECT c.id,c.code,c.name,
    ROUND(COALESCE(SUM(ib.total_amount),0),2)::numeric(15,2),
    ROUND(COALESCE(SUM(ib.paid_amount),0),2)::numeric(15,2),
    ROUND(COALESCE(SUM(ib.credit_note_amount),0),2)::numeric(15,2),
    ROUND(COALESCE(SUM(ib.credit_application_amount),0),2)::numeric(15,2),
    ROUND(COALESCE(SUM(ib.balance),0),2)::numeric(15,2),
    p_as_of_date
  FROM public.customers c
  LEFT JOIN invoice_balances ib ON ib.customer_id=c.id
  WHERE c.deleted_at IS NULL AND (p_customer_id IS NULL OR c.id=p_customer_id)
  GROUP BY c.id,c.code,c.name
  ORDER BY c.name;
END;
$customer_account_balances$;

REVOKE ALL ON FUNCTION public.get_customer_account_balances(date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_customer_account_balances(date,uuid) TO authenticated;

NOTIFY pgrst,'reload schema';


-- Refunds use the same configured clearing-account mapping as customer payments.
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
  IF p_payment_method NOT IN (
    'cash'::public.payment_method,
    'bank_transfer'::public.payment_method,
    'credit_card'::public.payment_method,
    'debit_card'::public.payment_method,
    'mobile_payment'::public.payment_method,
    'check'::public.payment_method
  ) THEN
    RAISE EXCEPTION 'Customer-credit refunds must use cash, bank transfer or mobile payment';
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
  v_payment_account := public.resolve_payment_account_id(p_payment_method);
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



CREATE OR REPLACE FUNCTION public.get_payment_clearing_balances()
RETURNS TABLE(account_code text,account_name text,clearing_balance numeric(15,2))
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_payment_clearing_balances$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin','accountant','auditor']) THEN
    RAISE EXCEPTION 'You are not authorized to view payment clearing balances';
  END IF;
  RETURN QUERY
  SELECT coa.code,coa.name,
    ROUND(COALESCE(SUM(jl.debit-jl.credit),0),2)::numeric(15,2)
  FROM public.chart_of_accounts coa
  LEFT JOIN public.journal_lines jl ON jl.account_id=coa.id
  LEFT JOIN public.journal_entries je ON je.id=jl.journal_entry_id
  WHERE coa.code IN ('1020','1030','1040')
  GROUP BY coa.code,coa.name
  ORDER BY coa.code;
END;
$get_payment_clearing_balances$;

REVOKE ALL ON FUNCTION public.get_payment_clearing_balances() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_payment_clearing_balances() TO authenticated;
