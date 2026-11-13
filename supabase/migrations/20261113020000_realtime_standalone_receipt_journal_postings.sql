-- Ensure every issued receipt is represented in the double-entry ledger.
-- Invoice-linked receipts reuse their payment journal; unallocated receipts are
-- posted to Cash/Bank against Customer Deposits (a liability), never revenue.
-- Voiding an unallocated receipt creates an auditable reversing journal entry.

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IN ('invoice', 'payment', 'receipt', 'receipt_void'));

INSERT INTO public.chart_of_accounts (
  code, name, description, account_type, account_subtype, is_system, is_active
)
VALUES (
  '2200',
  'Customer Deposits / Unapplied Receipts',
  'Funds received before they are applied to an invoice; classified as a current liability.',
  'liability',
  'current_liability',
  true,
  true
)
ON CONFLICT (code) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
    WHERE code = '2200'
      AND account_type = 'liability'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Chart of accounts code 2200 must be an active liability account for unapplied receipts';
  END IF;
END;
$$;

-- Add payment reference capture to the atomic receipt/payment RPC while keeping
-- retries idempotent. The previous function signature is replaced, not left as
-- an ambiguous PostgREST overload.
DROP FUNCTION IF EXISTS public.create_receipt_with_payment(
  uuid, uuid, uuid, numeric, public.payment_method, uuid, text, text, text, text, text
);

CREATE FUNCTION public.create_receipt_with_payment(
  p_customer_id uuid,
  p_invoice_id uuid,
  p_payment_id uuid,
  p_amount numeric,
  p_payment_method public.payment_method,
  p_idempotency_key uuid,
  p_notes text DEFAULT NULL,
  p_signature_data text DEFAULT NULL,
  p_signature_hash text DEFAULT NULL,
  p_checksum text DEFAULT NULL,
  p_issuer_name text DEFAULT NULL,
  p_reference_number text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_invoice_id uuid := p_invoice_id;
  v_payment_id uuid := p_payment_id;
  v_receipt_number text;
  v_receipt_id uuid;
  v_existing_payment public.payments%ROWTYPE;
  v_existing_receipt public.receipts%ROWTYPE;
  v_issuer_name text;
BEGIN
  IF v_user_id IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to issue receipts';
  END IF;

  IF p_customer_id IS NULL OR p_amount IS NULL OR ROUND(p_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive receipt amount are required';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required to issue a receipt';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  SELECT * INTO v_existing_receipt
  FROM public.receipts
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_receipt.issued_by IS DISTINCT FROM v_user_id
      OR v_existing_receipt.customer_id IS DISTINCT FROM p_customer_id
      OR ROUND(v_existing_receipt.amount, 2) IS DISTINCT FROM ROUND(p_amount, 2)
      OR v_existing_receipt.payment_method IS DISTINCT FROM p_payment_method
      OR NULLIF(BTRIM(v_existing_receipt.notes), '') IS DISTINCT FROM NULLIF(BTRIM(p_notes), '')
      OR v_existing_receipt.signature_hash IS DISTINCT FROM p_signature_hash
      OR (p_payment_id IS NOT NULL AND v_existing_receipt.payment_id IS DISTINCT FROM p_payment_id)
      OR (p_payment_id IS NULL AND v_existing_receipt.invoice_id IS DISTINCT FROM p_invoice_id) THEN
      RAISE EXCEPTION 'This receipt idempotency key was already used with different receipt details';
    END IF;

    IF v_existing_receipt.payment_id IS NOT NULL THEN
      SELECT * INTO v_existing_payment
      FROM public.payments
      WHERE id = v_existing_receipt.payment_id;

      IF v_existing_payment.reference_number IS DISTINCT FROM NULLIF(BTRIM(p_reference_number), '') THEN
        RAISE EXCEPTION 'This receipt idempotency key was already used with a different payment reference';
      END IF;
    END IF;

    RETURN v_existing_receipt.id;
  END IF;

  v_issuer_name := COALESCE(
    NULLIF(BTRIM(p_issuer_name), ''),
    NULLIF(auth.jwt() ->> 'email', ''),
    'Unknown'
  );

  IF v_payment_id IS NOT NULL THEN
    SELECT * INTO v_existing_payment
    FROM public.payments
    WHERE id = v_payment_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected payment could not be found';
    END IF;

    IF v_existing_payment.customer_id <> p_customer_id
      OR ROUND(v_existing_payment.amount, 2) <> ROUND(p_amount, 2)
      OR v_existing_payment.payment_method <> p_payment_method
      OR (v_invoice_id IS NOT NULL AND v_existing_payment.invoice_id <> v_invoice_id) THEN
      RAISE EXCEPTION 'The selected payment does not match this receipt';
    END IF;

    v_invoice_id := v_existing_payment.invoice_id;

    IF EXISTS (
      SELECT 1
      FROM public.receipts
      WHERE payment_id = v_payment_id
        AND status <> 'void'
        AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'A receipt has already been issued for this payment';
    END IF;
  ELSIF v_invoice_id IS NOT NULL THEN
    v_payment_id := public.record_invoice_payment(
      v_invoice_id,
      p_customer_id,
      ROUND(p_amount, 2),
      p_payment_method,
      p_idempotency_key,
      NULLIF(BTRIM(p_reference_number), ''),
      NULLIF(BTRIM(p_notes), '')
    );
  END IF;

  v_receipt_number := public.get_next_sequence('receipt');

  INSERT INTO public.receipts (
    receipt_number,
    customer_id,
    invoice_id,
    payment_id,
    amount,
    payment_method,
    notes,
    signature_data,
    signature_hash,
    checksum,
    issued_by,
    issuer_name,
    status,
    is_locked,
    idempotency_key
  )
  VALUES (
    v_receipt_number,
    p_customer_id,
    v_invoice_id,
    v_payment_id,
    ROUND(p_amount, 2),
    p_payment_method,
    NULLIF(BTRIM(p_notes), ''),
    p_signature_data,
    p_signature_hash,
    p_checksum,
    v_user_id,
    v_issuer_name,
    'issued',
    true,
    p_idempotency_key
  )
  RETURNING id INTO v_receipt_id;

  RETURN v_receipt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_receipt_with_payment(
  uuid, uuid, uuid, numeric, public.payment_method, uuid, text, text, text, text, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_receipt_with_payment(
  uuid, uuid, uuid, numeric, public.payment_method, uuid, text, text, text, text, text, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_receipt_journal_by_id(p_receipt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt public.receipts%ROWTYPE;
  v_cash_account uuid;
  v_credit_account uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_currency text;
  v_customer_name text;
  v_credit_description text;
BEGIN
  SELECT * INTO v_receipt
  FROM public.receipts
  WHERE id = p_receipt_id;

  IF NOT FOUND OR v_receipt.status <> 'issued' OR v_receipt.payment_id IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_cash_account
  FROM public.chart_of_accounts
  WHERE code = CASE WHEN v_receipt.payment_method = 'cash' THEN '1000' ELSE '1010' END
    AND account_type = 'asset'
    AND is_active = true
  LIMIT 1;

  IF v_receipt.invoice_id IS NOT NULL THEN
    -- Legacy invoice receipts without a linked payment settle Accounts Receivable.
    SELECT id INTO v_credit_account
    FROM public.chart_of_accounts
    WHERE code = '1100' AND account_type = 'asset' AND is_active = true
    LIMIT 1;
    v_credit_description := 'Accounts receivable settled - ' || v_receipt.receipt_number;
  ELSE
    -- An unapplied customer receipt is a liability until allocated to an invoice.
    SELECT id INTO v_credit_account
    FROM public.chart_of_accounts
    WHERE code = '2200' AND account_type = 'liability' AND is_active = true
    LIMIT 1;
    v_credit_description := 'Customer deposits / unapplied receipts - ' || v_receipt.receipt_number;
  END IF;

  IF v_cash_account IS NULL OR v_credit_account IS NULL THEN
    RAISE EXCEPTION 'Required cash/bank, receivable or customer-deposit accounts are not configured';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE source_type = 'receipt' AND source_id = v_receipt.id
  ) THEN
    RETURN;
  END IF;

  SELECT name INTO v_customer_name
  FROM public.customers
  WHERE id = v_receipt.customer_id;

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
    COALESCE(v_receipt.issue_date::date, CURRENT_DATE),
    CASE
      WHEN v_receipt.invoice_id IS NOT NULL
        THEN 'Direct receipt ' || v_receipt.receipt_number || ' received from ' || COALESCE(v_customer_name, 'customer')
      ELSE 'Unapplied receipt ' || v_receipt.receipt_number || ' received from ' || COALESCE(v_customer_name, 'customer')
    END,
    'receipt',
    v_receipt.id,
    v_currency,
    v_receipt.issued_by
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  )
  VALUES
    (v_journal_id, 1, v_cash_account, 'Cash/bank received - ' || v_receipt.receipt_number, ROUND(v_receipt.amount, 2), 0),
    (v_journal_id, 2, v_credit_account, v_credit_description, 0, ROUND(v_receipt.amount, 2));
END;
$$;

CREATE OR REPLACE FUNCTION public.post_unapplied_receipt_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'issued' OR NEW.payment_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to post standalone receipts';
  END IF;

  PERFORM public.post_receipt_journal_by_id(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER post_unapplied_receipt_journal_after_insert
AFTER INSERT ON public.receipts
FOR EACH ROW
EXECUTE FUNCTION public.post_unapplied_receipt_journal();

-- Backfill already-issued receipts that were not linked to a payment. This
-- includes standalone/unapplied receipts and legacy invoice receipts without
-- payment rows, so the ledger is complete from the migration onward.
DO $$
DECLARE
  v_receipt record;
BEGIN
  FOR v_receipt IN
    SELECT id
    FROM public.receipts
    WHERE status = 'issued'
      AND payment_id IS NULL
    ORDER BY issue_date, created_at, id
  LOOP
    PERFORM public.post_receipt_journal_by_id(v_receipt.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_unapplied_receipt_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_original public.journal_entries%ROWTYPE;
  v_reversal_id uuid;
  v_entry_number text;
  v_line record;
BEGIN
  IF OLD.status <> 'issued' OR NEW.status <> 'void'
    OR OLD.payment_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_original
  FROM public.journal_entries
  WHERE source_type = 'receipt' AND source_id = OLD.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE source_type = 'receipt_void' AND source_id = OLD.id
  ) THEN
    RETURN NEW;
  END IF;

  v_entry_number := public.get_next_sequence('journal');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  )
  VALUES (
    v_entry_number,
    CURRENT_DATE,
    'Reversal of voided receipt ' || OLD.receipt_number,
    'receipt_void',
    OLD.id,
    v_original.currency,
    auth.uid()
  )
  RETURNING id INTO v_reversal_id;

  FOR v_line IN
    SELECT account_id, description, debit, credit
    FROM public.journal_lines
    WHERE journal_entry_id = v_original.id
    ORDER BY line_number
  LOOP
    INSERT INTO public.journal_lines (
      journal_entry_id, line_number, account_id, description, debit, credit
    )
    VALUES (
      v_reversal_id,
      (SELECT COALESCE(MAX(line_number), 0) + 1 FROM public.journal_lines WHERE journal_entry_id = v_reversal_id),
      v_line.account_id,
      'Reversal: ' || v_line.description,
      v_line.credit,
      v_line.debit
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER reverse_unapplied_receipt_journal_after_void
AFTER UPDATE OF status ON public.receipts
FOR EACH ROW
EXECUTE FUNCTION public.reverse_unapplied_receipt_journal();

REVOKE ALL ON FUNCTION public.post_receipt_journal_by_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_unapplied_receipt_journal() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_unapplied_receipt_journal() FROM PUBLIC, anon;

-- Enable database change events for the live General Ledger view where the
-- standard Supabase Realtime publication is present. Polling remains a fallback.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.journal_entries;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END;
$$;
