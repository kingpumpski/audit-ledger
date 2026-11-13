-- Preserve the exact tax composition of each invoice line for future partial
-- credit notes. Aggregated invoice_taxes cannot safely reconstruct mixed or
-- compound tax allocations on historical invoices.
CREATE TABLE public.invoice_item_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  invoice_item_id uuid NOT NULL REFERENCES public.invoice_items(id) ON DELETE CASCADE,
  tax_id uuid NOT NULL REFERENCES public.taxes(id) ON DELETE RESTRICT,
  tax_name text NOT NULL,
  tax_code text NOT NULL,
  tax_rate numeric(8,4) NOT NULL CHECK (tax_rate >= 0),
  is_compound boolean NOT NULL DEFAULT false,
  tax_order integer NOT NULL CHECK (tax_order >= 0),
  taxable_amount numeric(15,2) NOT NULL CHECK (taxable_amount >= 0),
  tax_amount numeric(15,2) NOT NULL CHECK (tax_amount >= 0),
  liability_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_item_id, tax_id)
);

CREATE INDEX invoice_item_taxes_invoice_idx
  ON public.invoice_item_taxes(invoice_id, invoice_item_id, tax_order);

ALTER TABLE public.invoice_item_taxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_item_taxes_finance_read
  ON public.invoice_item_taxes FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'auditor']));
CREATE POLICY invoice_item_taxes_draft_insert
  ON public.invoice_item_taxes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(ARRAY['admin', 'accountant', 'cashier'])
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_item_taxes.invoice_id AND i.status = 'draft'
    )
  );
CREATE POLICY invoice_item_taxes_draft_update
  ON public.invoice_item_taxes FOR UPDATE TO authenticated
  USING (
    public.has_any_role(ARRAY['admin', 'accountant', 'cashier'])
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_item_taxes.invoice_id AND i.status = 'draft'
    )
  )
  WITH CHECK (
    public.has_any_role(ARRAY['admin', 'accountant', 'cashier'])
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_item_taxes.invoice_id AND i.status = 'draft'
    )
  );
CREATE POLICY invoice_item_taxes_draft_delete
  ON public.invoice_item_taxes FOR DELETE TO authenticated
  USING (
    public.has_any_role(ARRAY['admin', 'accountant', 'cashier'])
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_item_taxes.invoice_id AND i.status = 'draft'
    )
  );

REVOKE ALL ON TABLE public.invoice_item_taxes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoice_item_taxes TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_invoice_item_tax_snapshot_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $invoice_item_tax_snapshot_guard$
DECLARE
  v_invoice_id uuid;
  v_status text;
BEGIN
  v_invoice_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  SELECT status INTO v_status
  FROM public.invoices
  WHERE id = v_invoice_id
  FOR UPDATE;

  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Tax snapshots are immutable after an invoice is issued';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$invoice_item_tax_snapshot_guard$;

CREATE TRIGGER guard_invoice_item_tax_snapshot_mutations
BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_item_taxes
FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_item_tax_snapshot_mutations();

REVOKE ALL ON FUNCTION public.guard_invoice_item_tax_snapshot_mutations() FROM PUBLIC, anon, authenticated;
