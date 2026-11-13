-- Create invoice-linked payments and their receipts in one database transaction.
-- If receipt creation fails, the payment, invoice balance update and journal posting roll back too.

CREATE OR REPLACE FUNCTION public.create_receipt_with_payment(
  p_customer_id uuid,
  p_invoice_id uuid,
  p_payment_id uuid,
  p_amount numeric,
  p_payment_method public.payment_method,
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
  v_payment_number text;
  v_receipt_number text;
  v_receipt_id uuid;
  v_existing_payment public.payments%ROWTYPE;
  v_issuer_name text;
BEGIN
  IF v_user_id IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to issue receipts';
  END IF;

  IF p_customer_id IS NULL OR p_amount IS NULL OR ROUND(p_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive receipt amount are required';
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
  ELSIF v_invoice_id IS NOT NULL THEN
    v_payment_number := public.get_next_sequence('payment');

    INSERT INTO public.payments (
      payment_number,
      invoice_id,
      customer_id,
      amount,
      payment_method,
      notes,
      processed_by,
      payment_date
    )
    VALUES (
      v_payment_number,
      v_invoice_id,
      p_customer_id,
      ROUND(p_amount, 2),
      p_payment_method,
      NULLIF(BTRIM(p_notes), ''),
      v_user_id,
      now()
    )
    RETURNING id INTO v_payment_id;
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
    is_locked
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
    true
  )
  RETURNING id INTO v_receipt_id;

  RETURN v_receipt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_receipt_with_payment(
  uuid, uuid, uuid, numeric, public.payment_method, text, text, text, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_receipt_with_payment(
  uuid, uuid, uuid, numeric, public.payment_method, text, text, text, text, text
) TO authenticated;
