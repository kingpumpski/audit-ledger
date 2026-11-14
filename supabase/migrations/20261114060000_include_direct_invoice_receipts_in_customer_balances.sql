-- Include retained direct invoice receipts in date-driven customer receivables.
-- New receipts normally have a linked payment row. Legacy/direct invoice receipts
-- without payment_id still debit cash/clearing and credit Accounts Receivable, so
-- they must reduce the invoice balance without being counted twice.

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
      AND i.issue_date<=p_as_of_date
      AND EXISTS (
        SELECT 1 FROM public.journal_entries issued_entry
        WHERE issued_entry.source_type='invoice'
          AND issued_entry.source_id=i.id
          AND issued_entry.entry_date<=p_as_of_date
      )
      AND (p_customer_id IS NULL OR i.customer_id=p_customer_id)
  ),
  invoice_payments AS (
    SELECT settled.invoice_id,ROUND(SUM(settled.amount),2) AS amount
    FROM (
      SELECT p.invoice_id,p.amount
      FROM public.payments p
      WHERE p.deleted_at IS NULL AND p.payment_date::date<=p_as_of_date
      UNION ALL
      SELECT r.invoice_id,r.amount
      FROM public.receipts r
      WHERE r.deleted_at IS NULL
        AND r.status='issued'
        AND r.invoice_id IS NOT NULL
        AND r.payment_id IS NULL
        AND r.issue_date::date<=p_as_of_date
    ) settled
    JOIN issued_invoices i ON i.id=settled.invoice_id
    GROUP BY settled.invoice_id
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
