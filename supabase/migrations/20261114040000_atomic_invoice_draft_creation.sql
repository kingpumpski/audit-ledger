-- Create an invoice draft, all of its line items, per-line tax evidence and
-- aggregated tax allocations in one database transaction. A failed insert can
-- no longer leave an orphaned draft or a partially populated invoice.
CREATE OR REPLACE FUNCTION public.create_invoice_draft(
  p_customer_id uuid,
  p_issue_date date,
  p_due_date date,
  p_notes text,
  p_terms text,
  p_prices_include_tax boolean,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_tax_amount numeric,
  p_total_amount numeric,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $create_invoice_draft$
DECLARE
  v_user_id uuid := auth.uid();
  v_invoice_id uuid;
  v_invoice_number text;
  v_item jsonb;
  v_tax jsonb;
  v_tax_rule public.taxes%ROWTYPE;
  v_item_id uuid;
  v_product_category text;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_subtotal numeric;
  v_line_discount numeric;
  v_line_tax numeric;
  v_line_total numeric;
  v_tax_breakdown_total numeric;
  v_expected_subtotal numeric := 0;
  v_expected_discount numeric := 0;
  v_expected_tax numeric := 0;
  v_expected_total numeric;
  v_tax_order integer;
  v_item_count integer := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant', 'cashier']) THEN
    RAISE EXCEPTION 'You are not authorized to create invoices';
  END IF;

  IF p_customer_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.customers WHERE id = p_customer_id
  ) THEN
    RAISE EXCEPTION 'A valid customer is required to create an invoice';
  END IF;

  IF p_issue_date IS NULL OR p_subtotal IS NULL OR p_discount_amount IS NULL
     OR p_tax_amount IS NULL OR p_total_amount IS NULL
     OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Invoice date, totals and at least one invoice line are required';
  END IF;

  IF p_subtotal < 0 OR p_discount_amount < 0 OR p_tax_amount < 0 OR p_total_amount < 0 THEN
    RAISE EXCEPTION 'Invoice totals cannot be negative';
  END IF;

  v_invoice_number := public.get_next_sequence('invoice');

  INSERT INTO public.invoices (
    invoice_number, customer_id, status, issue_date, due_date,
    subtotal, discount_amount, tax_amount, total_amount, balance_due,
    notes, terms, created_by
  )
  VALUES (
    v_invoice_number, p_customer_id, 'draft', p_issue_date, p_due_date,
    ROUND(p_subtotal, 2), ROUND(p_discount_amount, 2), ROUND(p_tax_amount, 2),
    ROUND(p_total_amount, 2), ROUND(p_total_amount, 2),
    p_notes, p_terms, v_user_id
  )
  RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_count := v_item_count + 1;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;

    IF NULLIF(BTRIM(v_item->>'description'), '') IS NULL
       OR v_quantity <= 0 OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invoice line % requires a description, positive quantity and non-negative unit price', v_item_count;
    END IF;

    v_line_subtotal := ROUND(v_quantity * v_unit_price, 2);
    v_line_discount := CASE
      WHEN v_item->>'discount_type' = 'percentage'
        THEN ROUND(v_line_subtotal * LEAST(GREATEST(COALESCE((v_item->>'discount_value')::numeric, 0), 0), 100) / 100, 2)
      ELSE LEAST(GREATEST(COALESCE((v_item->>'discount_value')::numeric, 0), 0), v_line_subtotal)
    END;

    IF v_item->>'discount_type' IS NOT NULL
       AND v_item->>'discount_type' NOT IN ('fixed', 'percentage') THEN
      RAISE EXCEPTION 'Invoice line % has an unsupported discount type', v_item_count;
    END IF;

    v_line_tax := ROUND(COALESCE((v_item->>'tax_amount')::numeric, 0), 2);
    v_line_total := ROUND(COALESCE((v_item->>'line_total')::numeric, -1), 2);
    v_tax_breakdown_total := ROUND(COALESCE((
      SELECT SUM((tax_row->>'tax_amount')::numeric)
      FROM jsonb_array_elements(COALESCE(v_item->'tax_breakdown', '[]'::jsonb)) tax_row
    ), 0), 2);

    IF jsonb_typeof(COALESCE(v_item->'tax_breakdown', '[]'::jsonb)) <> 'array'
       OR v_line_tax < 0
       OR v_tax_breakdown_total IS DISTINCT FROM v_line_tax THEN
      RAISE EXCEPTION 'Invoice line % tax amount does not reconcile to its tax evidence', v_item_count;
    END IF;

    IF v_line_total IS DISTINCT FROM CASE
      WHEN COALESCE(p_prices_include_tax, false)
        THEN ROUND(v_line_subtotal - v_line_discount, 2)
      ELSE ROUND(v_line_subtotal - v_line_discount + v_line_tax, 2)
    END THEN
      RAISE EXCEPTION 'Invoice line % total does not reconcile to its subtotal, discount and tax', v_item_count;
    END IF;

    v_expected_subtotal := v_expected_subtotal + v_line_subtotal;
    v_expected_discount := v_expected_discount + v_line_discount;
    v_expected_tax := v_expected_tax + v_line_tax;

    INSERT INTO public.invoice_items (
      invoice_id, product_id, description, quantity, unit_price,
      discount_type, discount_value, tax_rate, tax_amount, line_total, sort_order
    )
    VALUES (
      v_invoice_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      BTRIM(v_item->>'description'),
      v_quantity,
      v_unit_price,
      NULLIF(v_item->>'discount_type', '')::public.discount_type,
      COALESCE((v_item->>'discount_value')::numeric, 0),
      COALESCE((v_item->>'tax_rate')::numeric, 0),
      v_line_tax,
      v_line_total,
      COALESCE((v_item->>'sort_order')::integer, v_item_count - 1)
    )
    RETURNING id INTO v_item_id;

    v_product_category := NULL;
    IF NULLIF(v_item->>'product_id', '') IS NOT NULL THEN
      SELECT category INTO v_product_category
      FROM public.products
      WHERE id = (v_item->>'product_id')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice line % references a product that no longer exists', v_item_count;
      END IF;
    END IF;

    v_tax_order := 0;
    FOR v_tax IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(v_item->'tax_breakdown', '[]'::jsonb))
      ORDER BY (value->>'tax_order')::integer
    LOOP
      SELECT * INTO v_tax_rule
      FROM public.taxes
      WHERE id = (v_tax->>'tax_id')::uuid
      FOR SHARE;

      IF NOT FOUND OR NOT COALESCE(v_tax_rule.is_active, false)
         OR v_tax_rule.effective_from > p_issue_date
         OR v_tax_rule.effective_to < p_issue_date
         OR v_tax_rule.rate < 0 OR v_tax_rule.rate > 100
         OR v_tax_rule.liability_account_id IS NULL THEN
        RAISE EXCEPTION 'Selected tax is unavailable, invalid or not effective on the invoice date';
      END IF;

      IF v_tax_rule.applies_to_category IS NOT NULL
         AND LOWER(v_tax_rule.applies_to_category) <> LOWER(COALESCE(v_product_category, '')) THEN
        RAISE EXCEPTION 'Tax % does not apply to the category of invoice line %', v_tax_rule.code, v_item_count;
      END IF;

      IF (v_tax->>'name') IS DISTINCT FROM v_tax_rule.name
         OR (v_tax->>'code') IS DISTINCT FROM v_tax_rule.code
         OR (v_tax->>'rate')::numeric IS DISTINCT FROM v_tax_rule.rate
         OR COALESCE((v_tax->>'is_compound')::boolean, false) IS DISTINCT FROM COALESCE(v_tax_rule.is_compound, false)
         OR (v_tax->>'tax_order')::integer <> v_tax_order THEN
        RAISE EXCEPTION 'Invoice line % tax evidence does not match the current tax definition or order', v_item_count;
      END IF;

      IF (v_tax->>'taxable_amount')::numeric < 0
         OR (v_tax->>'tax_amount')::numeric < 0
         OR ROUND((v_tax->>'taxable_amount')::numeric * v_tax_rule.rate / 100, 2)
            IS DISTINCT FROM ROUND((v_tax->>'tax_amount')::numeric, 2) THEN
        RAISE EXCEPTION 'Invoice line % contains an invalid tax calculation', v_item_count;
      END IF;

      INSERT INTO public.invoice_item_taxes (
        invoice_id, invoice_item_id, tax_id, tax_name, tax_code,
        tax_rate, is_compound, tax_order, taxable_amount, tax_amount,
        liability_account_id
      )
      VALUES (
        v_invoice_id, v_item_id, v_tax_rule.id, v_tax_rule.name, v_tax_rule.code,
        v_tax_rule.rate, COALESCE(v_tax_rule.is_compound, false), v_tax_order,
        ROUND((v_tax->>'taxable_amount')::numeric, 2),
        ROUND((v_tax->>'tax_amount')::numeric, 2),
        v_tax_rule.liability_account_id
      );

      v_tax_order := v_tax_order + 1;
    END LOOP;
  END LOOP;

  v_expected_subtotal := ROUND(v_expected_subtotal, 2);
  v_expected_discount := ROUND(v_expected_discount, 2);
  v_expected_tax := ROUND(v_expected_tax, 2);
  v_expected_total := CASE
    WHEN COALESCE(p_prices_include_tax, false)
      THEN ROUND(v_expected_subtotal - v_expected_discount, 2)
    ELSE ROUND(v_expected_subtotal - v_expected_discount + v_expected_tax, 2)
  END;

  IF v_expected_subtotal IS DISTINCT FROM ROUND(p_subtotal, 2)
     OR v_expected_discount IS DISTINCT FROM ROUND(p_discount_amount, 2)
     OR v_expected_tax IS DISTINCT FROM ROUND(p_tax_amount, 2)
     OR v_expected_total IS DISTINCT FROM ROUND(p_total_amount, 2) THEN
    RAISE EXCEPTION 'Invoice header totals do not reconcile to its line items and tax evidence';
  END IF;

  INSERT INTO public.invoice_taxes (
    invoice_id, tax_id, tax_rate, taxable_amount, tax_amount, liability_account_id
  )
  SELECT
    invoice_id, tax_id, MIN(tax_rate), ROUND(SUM(taxable_amount), 2),
    ROUND(SUM(tax_amount), 2), liability_account_id
  FROM public.invoice_item_taxes
  WHERE invoice_id = v_invoice_id
  GROUP BY invoice_id, tax_id, liability_account_id;

  RETURN v_invoice_id;
END;
$create_invoice_draft$;

REVOKE ALL ON FUNCTION public.create_invoice_draft(
  uuid, date, date, text, text, boolean, numeric, numeric, numeric, numeric, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_draft(
  uuid, date, date, text, text, boolean, numeric, numeric, numeric, numeric, jsonb
) TO authenticated;
