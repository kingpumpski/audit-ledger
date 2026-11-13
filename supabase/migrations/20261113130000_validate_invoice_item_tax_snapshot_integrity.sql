-- Validate the integrity of per-line tax evidence at the database boundary.
-- A snapshot must belong to the exact invoice line and reflect the authoritative
-- tax definition used when the draft invoice was prepared.
CREATE OR REPLACE FUNCTION public.validate_invoice_item_tax_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $invoice_item_tax_validate$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_item public.invoice_items%ROWTYPE;
  v_tax public.taxes%ROWTYPE;
BEGIN
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = NEW.invoice_id
  FOR UPDATE;

  IF NOT FOUND OR v_invoice.status <> 'draft' THEN
    RAISE EXCEPTION 'Tax snapshots can only be added to draft invoices';
  END IF;

  SELECT * INTO v_item
  FROM public.invoice_items
  WHERE id = NEW.invoice_item_id
    AND invoice_id = NEW.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tax snapshot invoice line does not belong to the specified invoice';
  END IF;

  SELECT * INTO v_tax
  FROM public.taxes
  WHERE id = NEW.tax_id;

  IF NOT FOUND
     OR NOT COALESCE(v_tax.is_active, false)
     OR NEW.tax_name IS DISTINCT FROM v_tax.name
     OR NEW.tax_code IS DISTINCT FROM v_tax.code
     OR NEW.tax_rate IS DISTINCT FROM v_tax.rate
     OR NEW.is_compound IS DISTINCT FROM v_tax.is_compound
     OR NEW.liability_account_id IS DISTINCT FROM v_tax.liability_account_id THEN
    RAISE EXCEPTION 'Tax snapshot must match the active authoritative tax definition';
  END IF;

  IF (v_tax.effective_from IS NOT NULL AND v_tax.effective_from > v_invoice.issue_date)
     OR (v_tax.effective_to IS NOT NULL AND v_tax.effective_to < v_invoice.issue_date) THEN
    RAISE EXCEPTION 'Tax was not effective on the invoice issue date';
  END IF;

  RETURN NEW;
END;
$invoice_item_tax_validate$;

CREATE TRIGGER validate_invoice_item_tax_snapshot
BEFORE INSERT OR UPDATE OF invoice_id, invoice_item_id, tax_id, tax_name, tax_code,
  tax_rate, is_compound, liability_account_id
ON public.invoice_item_taxes
FOR EACH ROW
EXECUTE FUNCTION public.validate_invoice_item_tax_snapshot();

REVOKE ALL ON FUNCTION public.validate_invoice_item_tax_snapshot() FROM PUBLIC, anon, authenticated;
