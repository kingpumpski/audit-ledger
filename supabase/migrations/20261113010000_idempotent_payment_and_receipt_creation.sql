-- Make payment and receipt creation safe to retry after timeouts or lost responses.
-- The same idempotency key is reused for retries of one user intent. Unique indexes
-- are the final database guard; transaction-scoped advisory locks serialize concurrent retries.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_uidx
  ON public.payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS receipts_idempotency_key_uidx
  ON public.receipts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Replace the old six-argument RPC so every application payment write can carry
-- an idempotency key. The insert trigger continues to update invoice balances
-- and post the journal entry in the same transaction.
DROP FUNCTION IF EXISTS public.record_invoice_payment(
  uuid, uuid, numeric, public.payment_method, text, text
);

CREATE FUNCTION public.record_invoice_payment(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method public.payment_method,
  p_reference_number text,
  p_notes text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment_id uuid;
  v_payment_number text;
  v_existing_payment public.payments%ROWTYPE;
  v_reference_number text := NULLIF(BTRIM(p_reference_number), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to record payments';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required to record a payment';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  SELECT * INTO v_existing_payment
  FROM public.payments
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_payment.invoice_id IS DISTINCT FROM p_invoice_id
      OR v_existing_payment.customer_id IS DISTINCT FROM p_customer_id
      OR ROUND(v_existing_payment.amount, 2) IS DISTINCT FROM ROUND(p_amount, 2)
      OR v_existing_payment.payment_method IS DISTINCT FROM p_payment_method
      OR v_existing_payment.reference_number IS DISTINCT FROM v_reference_number THEN
      RAISE EXCEPTION 'This payment idempotency key was already used with different payment details';
    END IF;

    RETURN v_existing_payment.id;
  END IF;

  v_payment_number := public.get_next_sequence('payment');

  INSERT INTO public.payments (
    payment_number,
    invoice_id,
    customer_id,
    amount,
    payment_method,
    reference_number,
    notes,
    processed_by,
    payment_date,
    idempotency_key
  )
  VALUES (
    v_payment_number,
    p_invoice_id,
    p_customer_id,
    ROUND(p_amount, 2),
    p_payment_method,
    v_reference_number,
    NULLIF(BTRIM(p_notes), ''),
    auth.uid(),
    now(),
    p_idempotency_key
  )
  RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_invoice_payment(
  uuid, uuid, numeric, public.payment_method, text, text, uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_invoice_payment(
  uuid, uuid, numeric, public.payment_method, text, text, uuid
) TO authenticated;

-- Replace the atomic receipt RPC with an idempotent version. The advisory lock
-- ensures two simultaneous retries with the same key cannot create two payments.
DROP FUNCTION IF EXISTS public.create_receipt_with_payment(
  uuid, uuid, uuid, numeric, public.payment_method, text, text, text, text, text
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
  p_issuer_name text DEFAULT NULL
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
    IF v_existing_receipt.customer_id IS DISTINCT FROM p_customer_id
      OR ROUND(v_existing_receipt.amount, 2) IS DISTINCT FROM ROUND(p_amount, 2)
      OR v_existing_receipt.payment_method IS DISTINCT FROM p_payment_method
      OR (p_payment_id IS NOT NULL AND v_existing_receipt.payment_id IS DISTINCT FROM p_payment_id)
      OR (p_payment_id IS NULL AND v_existing_receipt.invoice_id IS DISTINCT FROM p_invoice_id) THEN
      RAISE EXCEPTION 'This receipt idempotency key was already used with different receipt details';
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
      NULL,
      NULLIF(BTRIM(p_notes), ''),
      p_idempotency_key
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
  uuid, uuid, uuid, numeric, public.payment_method, uuid, text, text, text, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_receipt_with_payment(
  uuid, uuid, uuid, numeric, public.payment_method, uuid, text, text, text, text, text
) TO authenticated;
