-- Revalidate tax evidence at the point an invoice becomes an issued financial document.
-- Draft snapshots can otherwise become stale if a tax definition or line allocation
-- is changed after snapshot creation but before issue.
CREATE OR REPLACE FUNCTION public.validate_invoice_tax_allocations_before_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $invoice_tax_issue_guard$
DECLARE
  v_snapshot_tax_total numeric(15,2);
  v_invoice_tax_total numeric(15,2);
  v_snapshot_count bigint;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status OR NEW.status <> 'issued' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_snapshot_count
  FROM public.invoice_item_taxes
  WHERE invoice_id = NEW.id;

  -- Preserve compatibility for drafts created before per-line snapshots existed.
  -- Their aggregate invoice tax evidence remains usable for issuing, but those
  -- invoices must be excluded from future line-level credit-note workflows.
  IF v_snapshot_count = 0 THEN
    RETURN NEW;
  END IF;

  -- Every line's tax amount must be fully supported by its own immutable-at-issue
  -- tax allocation rows. This also blocks legacy/draft taxed invoices whose
  -- per-line tax allocation cannot be established.
  IF EXISTS (
    SELECT 1
    FROM public.invoice_items ii
    LEFT JOIN (
      SELECT invoice_item_id, ROUND(SUM(tax_amount), 2) AS tax_amount
      FROM public.invoice_item_taxes
      WHERE invoice_id = NEW.id
      GROUP BY invoice_item_id
    ) snap ON snap.invoice_item_id = ii.id
    WHERE ii.invoice_id = NEW.id
      AND ROUND(COALESCE(ii.tax_amount, 0), 2)
          IS DISTINCT FROM ROUND(COALESCE(snap.tax_amount, 0), 2)
  ) THEN
    RAISE EXCEPTION 'Invoice line tax snapshots do not reconcile to invoice line tax amounts';
  END IF;

  SELECT ROUND(COALESCE(SUM(tax_amount), 0), 2)
  INTO v_snapshot_tax_total
  FROM public.invoice_item_taxes
  WHERE invoice_id = NEW.id;

  v_invoice_tax_total := ROUND(COALESCE(NEW.tax_amount, 0), 2);
  IF v_snapshot_tax_total IS DISTINCT FROM v_invoice_tax_total THEN
    RAISE EXCEPTION 'Invoice line tax snapshots do not reconcile to the invoice tax total';
  END IF;

  -- The client must preserve the deterministic calculation order used by the
  -- invoice tax engine: non-compound taxes first, then compound taxes, each by code.
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT tax_order,
             ROW_NUMBER() OVER (
               PARTITION BY invoice_item_id
               ORDER BY is_compound ASC, tax_code ASC
             ) - 1 AS expected_order
      FROM public.invoice_item_taxes
      WHERE invoice_id = NEW.id
    ) ordered_tax
    WHERE ordered_tax.tax_order <> ordered_tax.expected_order
  ) THEN
    RAISE EXCEPTION 'Invoice line tax snapshot order is invalid';
  END IF;

  -- Recheck the authoritative definition and effective date now, not merely
  -- when the draft snapshot was first inserted.
  IF EXISTS (
    SELECT 1
    FROM public.invoice_item_taxes s
    LEFT JOIN public.taxes t ON t.id = s.tax_id
    WHERE s.invoice_id = NEW.id
      AND (
        t.id IS NULL
        OR NOT COALESCE(t.is_active, false)
        OR s.tax_name IS DISTINCT FROM t.name
        OR s.tax_code IS DISTINCT FROM t.code
        OR s.tax_rate IS DISTINCT FROM t.rate
        OR s.is_compound IS DISTINCT FROM t.is_compound
        OR s.liability_account_id IS DISTINCT FROM t.liability_account_id
        OR (t.effective_from IS NOT NULL AND t.effective_from > NEW.issue_date)
        OR (t.effective_to IS NOT NULL AND t.effective_to < NEW.issue_date)
      )
  ) THEN
    RAISE EXCEPTION 'Invoice tax snapshot no longer matches the authoritative tax definition or issue date';
  END IF;

  -- Aggregated invoice_taxes must reconcile exactly to the per-line evidence,
  -- including tax base and liability account. The two sources are both used by
  -- invoice journal posting and downstream credit-note calculations.
  IF EXISTS (
    WITH line_totals AS (
      SELECT tax_id, liability_account_id,
             MIN(tax_rate) AS tax_rate,
             ROUND(SUM(taxable_amount), 2) AS taxable_amount,
             ROUND(SUM(tax_amount), 2) AS tax_amount
      FROM public.invoice_item_taxes
      WHERE invoice_id = NEW.id
      GROUP BY tax_id, liability_account_id
    ),
    invoice_totals AS (
      SELECT tax_id, liability_account_id,
             MIN(tax_rate) AS tax_rate,
             ROUND(SUM(taxable_amount), 2) AS taxable_amount,
             ROUND(SUM(tax_amount), 2) AS tax_amount
      FROM public.invoice_taxes
      WHERE invoice_id = NEW.id
      GROUP BY tax_id, liability_account_id
    )
    SELECT 1
    FROM line_totals l
    FULL OUTER JOIN invoice_totals i
      ON i.tax_id = l.tax_id
     AND i.liability_account_id = l.liability_account_id
    WHERE l.tax_id IS NULL
       OR i.tax_id IS NULL
       OR l.tax_rate IS DISTINCT FROM i.tax_rate
       OR l.taxable_amount IS DISTINCT FROM i.taxable_amount
       OR l.tax_amount IS DISTINCT FROM i.tax_amount
  ) THEN
    RAISE EXCEPTION 'Invoice-level tax totals do not reconcile to per-line tax snapshots';
  END IF;

  RETURN NEW;
END;
$invoice_tax_issue_guard$;

CREATE TRIGGER validate_invoice_tax_allocations_before_issue
BEFORE UPDATE OF status ON public.invoices
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'issued')
EXECUTE FUNCTION public.validate_invoice_tax_allocations_before_issue();

REVOKE ALL ON FUNCTION public.validate_invoice_tax_allocations_before_issue() FROM PUBLIC, anon, authenticated;
