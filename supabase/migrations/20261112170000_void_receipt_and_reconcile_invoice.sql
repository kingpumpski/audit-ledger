-- Void a receipt and reconcile its invoice balance atomically.
-- Receipts generated from an existing payment are documentary copies; voiding
-- those receipts must not reverse the underlying payment. Standalone receipts
-- directly affect invoice.amount_paid and are reversed exactly once here.

CREATE OR REPLACE FUNCTION public.void_receipt_and_reconcile(receipt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_receipt public.receipts%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_new_amount_paid numeric(15,2);
  v_new_balance_due numeric(15,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'accountant'::public.app_role)
    OR public.has_role(auth.uid(), 'cashier'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to void receipts' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_receipt
    FROM public.receipts
   WHERE id = receipt_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  IF v_receipt.status <> 'issued' THEN
    RAISE EXCEPTION 'Only issued receipts can be voided';
  END IF;

  -- The row lock and status predicate make repeated/concurrent void attempts safe.
  UPDATE public.receipts
     SET status = 'void',
         deleted_at = COALESCE(deleted_at, now())
   WHERE id = v_receipt.id
     AND status = 'issued';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt has already been voided';
  END IF;

  -- A linked payment is the accounting source of truth. Its generated receipt
  -- does not independently increase or decrease invoice balances.
  IF v_receipt.invoice_id IS NOT NULL AND v_receipt.payment_id IS NULL THEN
    SELECT *
      INTO v_invoice
      FROM public.invoices
     WHERE id = v_receipt.invoice_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked invoice not found';
    END IF;

    v_new_amount_paid := GREATEST(
      0,
      COALESCE(v_invoice.amount_paid, 0) - v_receipt.amount
    );
    v_new_balance_due := GREATEST(
      0,
      COALESCE(v_invoice.total_amount, 0) - v_new_amount_paid
    );

    UPDATE public.invoices
       SET amount_paid = v_new_amount_paid,
           balance_due = v_new_balance_due,
           status = CASE
             WHEN v_invoice.status IN ('draft', 'canceled') THEN v_invoice.status
             WHEN v_new_amount_paid >= COALESCE(v_invoice.total_amount, 0) THEN 'paid'::public.invoice_status
             WHEN v_new_amount_paid > 0 THEN 'partially_paid'::public.invoice_status
             WHEN v_invoice.due_date IS NOT NULL AND v_invoice.due_date < CURRENT_DATE THEN 'overdue'::public.invoice_status
             ELSE 'issued'::public.invoice_status
           END
     WHERE id = v_invoice.id;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.void_receipt_and_reconcile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_receipt_and_reconcile(uuid) TO authenticated, service_role;
