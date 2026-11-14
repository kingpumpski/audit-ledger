-- Keep invoice workflow status aligned with the receivable after credit settlement.
-- Both direct credit notes and customer-credit applications reduce balance_due
-- without creating a cash payment. A zero receivable is fully settled.
CREATE OR REPLACE FUNCTION public.set_invoice_paid_status_after_credit_settlement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $invoice_credit_status$
BEGIN
  IF OLD.status IN (
       'issued'::public.invoice_status,
       'partially_paid'::public.invoice_status,
       'overdue'::public.invoice_status
     )
     AND COALESCE(NEW.balance_due, 0) <= 0 THEN
    NEW.status := 'paid'::public.invoice_status;
  END IF;

  RETURN NEW;
END;
$invoice_credit_status$;

DROP TRIGGER IF EXISTS set_invoice_paid_status_after_credit_settlement ON public.invoices;
CREATE TRIGGER set_invoice_paid_status_after_credit_settlement
BEFORE UPDATE OF balance_due ON public.invoices
FOR EACH ROW
WHEN (OLD.balance_due IS DISTINCT FROM NEW.balance_due)
EXECUTE FUNCTION public.set_invoice_paid_status_after_credit_settlement();

REVOKE ALL ON FUNCTION public.set_invoice_paid_status_after_credit_settlement() FROM PUBLIC, anon, authenticated;
