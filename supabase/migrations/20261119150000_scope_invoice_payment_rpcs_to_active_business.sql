-- Scope invoice creation, issuance, payment, receipt and sequence RPCs to the
-- authenticated active business. Each parent lookup and write is explicitly
-- bound to one tenant in addition to the restrictive RLS policy.

CREATE OR REPLACE FUNCTION public.get_next_sequence(seq_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_business_id uuid := public.current_business_id();
  result text;
  seq record;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to allocate a number'
      USING ERRCODE = '42501';
  END IF;

  IF seq_name NOT IN ('invoice', 'receipt', 'payment', 'customer', 'product', 'journal', 'account') THEN
    RAISE EXCEPTION 'Invalid sequence name: %', seq_name
      USING ERRCODE = '22023';
  END IF;

  IF seq_name IN ('invoice', 'receipt', 'payment', 'journal') THEN
    IF NOT public.has_business_role(v_business_id, ARRAY['owner','admin','accountant','cashier']::text[]) THEN
      RAISE EXCEPTION 'You are not authorized to allocate this transaction number'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.has_business_role(v_business_id, ARRAY['owner','admin','accountant']::text[]) THEN
    RAISE EXCEPTION 'Only an administrator or accountant can allocate this master-data number'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.sequences
  SET current_value = current_value + 1,
      updated_at = now()
  WHERE name = seq_name
    AND business_id = v_business_id
  RETURNING prefix, current_value, padding INTO seq;

  IF seq.prefix IS NULL THEN
    RAISE EXCEPTION 'Sequence not found: %', seq_name;
  END IF;

  result := seq.prefix || lpad(seq.current_value::text, seq.padding, '0');
  RETURN result;
END;
$function$;

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
  v_business_id uuid := public.current_business_id();
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
  v_amount_after_discount numeric;
  v_accumulated_tax_factor numeric;
  v_total_tax_factor numeric;
  v_taxable_factor numeric;
  v_tax_factor numeric;
  v_taxable_base numeric;
  v_previous_compound boolean;
  v_previous_tax_code text;
  v_item_count integer := 0;
BEGIN
  IF v_user_id IS NULL OR v_business_id IS NULL OR NOT public.has_business_role(v_business_id, ARRAY['owner','admin','accountant','cashier']::text[]) THEN
    RAISE EXCEPTION 'You are not authorized to create invoices';
  END IF;

  IF p_customer_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.customers WHERE id = p_customer_id AND business_id = v_business_id
  ) THEN
    RAISE EXCEPTION 'A valid customer is required to create an invoice';
  END IF;

  IF p_issue_date IS NULL OR p_subtotal IS NULL OR p_discount_amount IS NULL
     OR p_tax_amount IS NULL OR p_total_amount IS NULL OR p_items IS NULL THEN
    RAISE EXCEPTION 'Invoice date, totals and at least one invoice line are required';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Invoice lines must be supplied as an array';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one invoice line is required';
  END IF;

  IF p_subtotal < 0 OR p_discount_amount < 0 OR p_tax_amount < 0 OR p_total_amount < 0 THEN
    RAISE EXCEPTION 'Invoice totals cannot be negative';
  END IF;

  v_invoice_number := public.get_next_sequence('invoice');

  INSERT INTO public.invoices (
    business_id, invoice_number, customer_id, status, issue_date, due_date,
    subtotal, discount_amount, tax_amount, total_amount, balance_due,
    notes, terms, created_by
  )
  VALUES (
    v_business_id, v_invoice_number, p_customer_id, 'draft', p_issue_date, p_due_date,
    ROUND(p_subtotal, 2), ROUND(p_discount_amount, 2), ROUND(p_tax_amount, 2),
    ROUND(p_total_amount, 2), ROUND(p_total_amount, 2),
    p_notes, p_terms, v_user_id
  )
  RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_count := v_item_count + 1;
    v_quantity := NULLIF(v_item->>'quantity', '')::numeric;
    v_unit_price := NULLIF(v_item->>'unit_price', '')::numeric;

    IF NULLIF(BTRIM(v_item->>'description'), '') IS NULL
       OR v_quantity IS NULL OR v_unit_price IS NULL
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

    IF jsonb_typeof(COALESCE(v_item->'tax_breakdown', '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'Invoice line % tax evidence must be supplied as an array', v_item_count;
    END IF;

    v_line_tax := ROUND(COALESCE((v_item->>'tax_amount')::numeric, 0), 2);
    v_line_total := ROUND(COALESCE((v_item->>'line_total')::numeric, -1), 2);
    v_tax_breakdown_total := ROUND(COALESCE((
      SELECT SUM((tax_row.value->>'tax_amount')::numeric)
      FROM jsonb_array_elements(COALESCE(v_item->'tax_breakdown', '[]'::jsonb)) AS tax_row(value)
    ), 0), 2);

    IF v_line_tax < 0
       OR v_tax_breakdown_total IS DISTINCT FROM v_line_tax THEN
      RAISE EXCEPTION 'Invoice line % tax amount does not reconcile to its tax evidence', v_item_count;
    END IF;

    IF v_line_total IS DISTINCT FROM (
      CASE
        WHEN COALESCE(p_prices_include_tax, false)
          THEN ROUND(v_line_subtotal - v_line_discount, 2)
        ELSE ROUND(v_line_subtotal - v_line_discount + v_line_tax, 2)
      END
    ) THEN
      RAISE EXCEPTION 'Invoice line % total does not reconcile to its subtotal, discount and tax', v_item_count;
    END IF;

    v_expected_subtotal := v_expected_subtotal + v_line_subtotal;
    v_expected_discount := v_expected_discount + v_line_discount;
    v_expected_tax := v_expected_tax + v_line_tax;

    -- Recompute the same ordered compound-tax factors as the invoice
    -- calculator, rather than trusting client-supplied tax bases or amounts.
    v_amount_after_discount := ROUND(v_line_subtotal - v_line_discount, 2);
    v_accumulated_tax_factor := 0;
    v_total_tax_factor := 0;
    FOR v_tax IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(v_item->'tax_breakdown', '[]'::jsonb))
      ORDER BY (value->>'tax_order')::integer
    LOOP
      SELECT * INTO v_tax_rule
      FROM public.taxes
      WHERE id = (v_tax->>'tax_id')::uuid
        AND business_id = v_business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice line % references an unknown tax', v_item_count;
      END IF;
      v_taxable_factor := CASE
        WHEN COALESCE(v_tax_rule.is_compound, false) THEN 1 + v_accumulated_tax_factor
        ELSE 1
      END;
      v_tax_factor := v_taxable_factor * v_tax_rule.rate / 100;
      v_accumulated_tax_factor := v_accumulated_tax_factor + v_tax_factor;
      v_total_tax_factor := v_total_tax_factor + v_tax_factor;
    END LOOP;

    v_taxable_base := CASE
      WHEN COALESCE(p_prices_include_tax, false) AND v_total_tax_factor > 0
        THEN v_amount_after_discount / (1 + v_total_tax_factor)
      ELSE v_amount_after_discount
    END;
    v_accumulated_tax_factor := 0;

    INSERT INTO public.invoice_items (
      business_id, invoice_id, product_id, description, quantity, unit_price,
      discount_type, discount_value, tax_rate, tax_amount, line_total, sort_order
    )
    VALUES (
      v_business_id,
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
      WHERE id = (v_item->>'product_id')::uuid
        AND business_id = v_business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice line % references a product that no longer exists', v_item_count;
      END IF;
    END IF;

    v_tax_order := 0;
    v_previous_compound := NULL;
    v_previous_tax_code := NULL;
    FOR v_tax IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(v_item->'tax_breakdown', '[]'::jsonb))
      ORDER BY (value->>'tax_order')::integer
    LOOP
      SELECT * INTO v_tax_rule
      FROM public.taxes
      WHERE id = (v_tax->>'tax_id')::uuid
        AND business_id = v_business_id
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

      IF v_tax_order > 0 AND (
        (v_previous_compound AND NOT COALESCE(v_tax_rule.is_compound, false))
        OR (
          v_previous_compound = COALESCE(v_tax_rule.is_compound, false)
          AND v_previous_tax_code > v_tax_rule.code
        )
      ) THEN
        RAISE EXCEPTION 'Invoice line % taxes are not in deterministic non-compound/code order', v_item_count;
      END IF;
      v_previous_compound := COALESCE(v_tax_rule.is_compound, false);
      v_previous_tax_code := v_tax_rule.code;

      v_taxable_factor := CASE
        WHEN COALESCE(v_tax_rule.is_compound, false) THEN 1 + v_accumulated_tax_factor
        ELSE 1
      END;
      v_tax_factor := v_taxable_factor * v_tax_rule.rate / 100;

      IF (v_tax->>'taxable_amount')::numeric < 0
         OR (v_tax->>'tax_amount')::numeric < 0
         OR ROUND((v_tax->>'taxable_amount')::numeric, 2)
            IS DISTINCT FROM ROUND(v_taxable_base * v_taxable_factor, 2)
         OR ROUND((v_tax->>'tax_amount')::numeric, 2)
            IS DISTINCT FROM ROUND(v_taxable_base * v_tax_factor, 2) THEN
        RAISE EXCEPTION 'Invoice line % contains an invalid tax calculation', v_item_count;
      END IF;

      v_accumulated_tax_factor := v_accumulated_tax_factor + v_tax_factor;

      INSERT INTO public.invoice_item_taxes (
        business_id, invoice_id, invoice_item_id, tax_id, tax_name, tax_code,
        tax_rate, is_compound, tax_order, taxable_amount, tax_amount,
        liability_account_id
      )
      VALUES (
        v_business_id, v_invoice_id, v_item_id, v_tax_rule.id, v_tax_rule.name, v_tax_rule.code,
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
    business_id, invoice_id, tax_id, tax_rate, taxable_amount, tax_amount, liability_account_id
  )
  SELECT
    v_business_id, invoice_id, tax_id, MIN(tax_rate), ROUND(SUM(taxable_amount), 2),
    ROUND(SUM(tax_amount), 2), liability_account_id
  FROM public.invoice_item_taxes
  WHERE invoice_id = v_invoice_id
    AND business_id = v_business_id
  GROUP BY invoice_id, tax_id, liability_account_id;

  RETURN v_invoice_id;
END;
$create_invoice_draft$;

CREATE OR REPLACE FUNCTION public.post_invoice_journal(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_invoice public.invoices%ROWTYPE;
  v_journal_id uuid;
  v_entry_number text;
  v_ar_account uuid;
  v_revenue_account uuid;
  v_default_tax_account uuid;
  v_currency text;
  v_tax_snapshot_total numeric(14,2) := 0;
  v_tax_total numeric(14,2) := 0;
  v_revenue_total numeric(14,2) := 0;
  v_line_number integer := 1;
  v_tax_row record;
  v_debits numeric(14,2);
  v_credits numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL OR NOT public.has_business_role(v_business_id, ARRAY['owner','admin','accountant','cashier']::text[]) THEN
    RAISE EXCEPTION 'You are not authorized to post invoice journals';
  END IF;

  SELECT id INTO v_journal_id
  FROM public.journal_entries
  WHERE source_type = 'invoice' AND source_id = p_invoice_id AND business_id = v_business_id;
  IF v_journal_id IS NOT NULL THEN
    RETURN v_journal_id;
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id AND business_id = v_business_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_invoice.status <> 'issued' THEN
    RAISE EXCEPTION 'Only an issued invoice can be posted to the ledger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = p_invoice_id AND business_id = v_business_id) THEN
    RAISE EXCEPTION 'An invoice must contain at least one line item before it can be posted';
  END IF;
  IF COALESCE(v_invoice.total_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Invoice total must be greater than zero';
  END IF;

  SELECT id INTO v_ar_account
  FROM public.chart_of_accounts
  WHERE code = '1100' AND account_type = 'asset' AND is_active AND business_id = v_business_id
  LIMIT 1;

  SELECT id INTO v_revenue_account
  FROM public.chart_of_accounts
  WHERE code = '4000' AND account_type = 'revenue' AND is_active AND business_id = v_business_id
  LIMIT 1;

  SELECT id INTO v_default_tax_account
  FROM public.chart_of_accounts
  WHERE code = '2100' AND account_type = 'liability' AND is_active AND business_id = v_business_id
  LIMIT 1;

  IF v_ar_account IS NULL OR v_revenue_account IS NULL OR v_default_tax_account IS NULL THEN
    RAISE EXCEPTION 'Required system accounts are not configured';
  END IF;

  v_tax_total := ROUND(COALESCE(v_invoice.tax_amount, 0), 2);
  IF v_tax_total < 0 OR v_tax_total > ROUND(COALESCE(v_invoice.total_amount, 0), 2) THEN
    RAISE EXCEPTION 'Invoice tax total is invalid';
  END IF;
  v_revenue_total := ROUND(COALESCE(v_invoice.total_amount, 0) - v_tax_total, 2);

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
  FROM public.company_settings
  WHERE business_id = v_business_id
  ORDER BY created_at
  LIMIT 1;
  v_currency := COALESCE(v_currency, 'USD');

  INSERT INTO public.journal_entries (
    business_id, entry_number, entry_date, description, source_type, source_id, currency, created_by
  )
  VALUES (
    v_business_id,
    v_entry_number,
    COALESCE(v_invoice.issue_date, CURRENT_DATE),
    'Invoice ' || v_invoice.invoice_number || ' issued',
    'invoice',
    p_invoice_id,
    v_currency,
    auth.uid()
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, line_number, account_id, description, debit, credit
  )
  VALUES (
    v_journal_id, v_line_number, v_ar_account,
    'Accounts receivable - ' || v_invoice.invoice_number,
    ROUND(v_invoice.total_amount, 2), 0
  );
  v_line_number := v_line_number + 1;

  IF v_revenue_total > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id, line_number, account_id, description, debit, credit
    )
    VALUES (
      v_journal_id, v_line_number, v_revenue_account,
      'Sales revenue - ' || v_invoice.invoice_number,
      0, v_revenue_total
    );
    v_line_number := v_line_number + 1;
  END IF;

  FOR v_tax_row IN
    SELECT liability_account_id, ROUND(SUM(tax_amount), 2) AS tax_amount
    FROM public.invoice_taxes
    WHERE invoice_id = p_invoice_id AND business_id = v_business_id
    GROUP BY liability_account_id
    ORDER BY liability_account_id
  LOOP
    IF v_tax_row.tax_amount > 0 THEN
      INSERT INTO public.journal_lines (
        journal_entry_id, line_number, account_id, description, debit, credit
      )
      VALUES (
        v_journal_id, v_line_number, v_tax_row.liability_account_id,
        'Tax payable - ' || v_invoice.invoice_number,
        0, v_tax_row.tax_amount
      );
      v_line_number := v_line_number + 1;
      v_tax_snapshot_total := v_tax_snapshot_total + v_tax_row.tax_amount;
    END IF;
  END LOOP;

  IF v_tax_total - v_tax_snapshot_total > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id, line_number, account_id, description, debit, credit
    )
    VALUES (
      v_journal_id, v_line_number, v_default_tax_account,
      'Unallocated tax payable - ' || v_invoice.invoice_number,
      0, ROUND(v_tax_total - v_tax_snapshot_total, 2)
    );
  ELSIF v_tax_snapshot_total - v_tax_total > 0 THEN
    RAISE EXCEPTION 'Invoice tax snapshots do not reconcile to the invoice tax total';
  END IF;

  SELECT ROUND(COALESCE(SUM(debit), 0), 2), ROUND(COALESCE(SUM(credit), 0), 2)
  INTO v_debits, v_credits
  FROM public.journal_lines
  WHERE journal_entry_id = v_journal_id AND business_id = v_business_id;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'Invoice journal is not balanced (debits %, credits %)', v_debits, v_credits;
  END IF;

  RETURN v_journal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_invoice public.invoices%ROWTYPE;
  v_journal_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL OR NOT public.has_business_role(v_business_id, ARRAY['owner','admin','accountant','cashier']::text[]) THEN
    RAISE EXCEPTION 'You are not authorized to issue invoices';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id AND business_id = v_business_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF v_invoice.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft invoices can be issued';
  END IF;

  UPDATE public.invoices
  SET status = 'issued',
      issued_at = now(),
      issued_by = auth.uid(),
      is_locked = true
  WHERE id = p_invoice_id AND business_id = v_business_id;

  SELECT id INTO v_journal_id
  FROM public.journal_entries
  WHERE source_type = 'invoice' AND source_id = p_invoice_id AND business_id = v_business_id;

  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'Invoice was issued but its journal entry was not created';
  END IF;

  RETURN v_journal_id;
END;
$$;

CREATE FUNCTION public.record_invoice_payment(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method public.payment_method,
  p_idempotency_key uuid,
  p_reference_number text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_payment_id uuid;
  v_payment_number text;
  v_existing_payment public.payments%ROWTYPE;
  v_reference_number text := NULLIF(BTRIM(p_reference_number), '');
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL OR NOT public.has_business_role(v_business_id, ARRAY['owner','admin','accountant','cashier']::text[]) THEN
    RAISE EXCEPTION 'You are not authorized to record payments';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required to record a payment';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':' || p_idempotency_key::text, 0));

  SELECT * INTO v_existing_payment
  FROM public.payments
  WHERE idempotency_key = p_idempotency_key AND business_id = v_business_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_payment.processed_by IS DISTINCT FROM auth.uid()
      OR v_existing_payment.invoice_id IS DISTINCT FROM p_invoice_id
      OR v_existing_payment.customer_id IS DISTINCT FROM p_customer_id
      OR ROUND(v_existing_payment.amount, 2) IS DISTINCT FROM ROUND(p_amount, 2)
      OR v_existing_payment.payment_method IS DISTINCT FROM p_payment_method
      OR v_existing_payment.reference_number IS DISTINCT FROM v_reference_number
      OR NULLIF(BTRIM(v_existing_payment.notes), '') IS DISTINCT FROM NULLIF(BTRIM(p_notes), '') THEN
      RAISE EXCEPTION 'This payment idempotency key was already used with different payment details';
    END IF;

    RETURN v_existing_payment.id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.customers c ON c.id = i.customer_id AND c.business_id = v_business_id
    WHERE i.id = p_invoice_id AND i.customer_id = p_customer_id
      AND i.business_id = v_business_id AND i.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Invoice not found for the selected customer in the active business'
      USING ERRCODE = '42501';
  END IF;

  v_payment_number := public.get_next_sequence('payment');

  INSERT INTO public.payments (
    business_id,
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
    v_business_id,
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
  v_business_id uuid := public.current_business_id();
  v_invoice_id uuid := p_invoice_id;
  v_payment_id uuid := p_payment_id;
  v_receipt_number text;
  v_receipt_id uuid;
  v_existing_payment public.payments%ROWTYPE;
  v_existing_receipt public.receipts%ROWTYPE;
  v_issuer_name text;
BEGIN
  IF v_user_id IS NULL OR v_business_id IS NULL OR NOT public.has_business_role(v_business_id, ARRAY['owner','admin','accountant','cashier']::text[]) THEN
    RAISE EXCEPTION 'You are not authorized to issue receipts';
  END IF;

  IF p_customer_id IS NULL OR p_amount IS NULL OR ROUND(p_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive receipt amount are required';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required to issue a receipt';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':' || p_idempotency_key::text, 0));

  SELECT * INTO v_existing_receipt
  FROM public.receipts
  WHERE idempotency_key = p_idempotency_key AND business_id = v_business_id
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
      WHERE id = v_existing_receipt.payment_id AND business_id = v_business_id;

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
      AND business_id = v_business_id
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
        AND business_id = v_business_id
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
    business_id,
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
    v_business_id,
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

REVOKE ALL ON FUNCTION public.get_next_sequence(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_sequence(text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_invoice_draft(uuid,date,date,text,text,boolean,numeric,numeric,numeric,numeric,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_draft(uuid,date,date,text,text,boolean,numeric,numeric,numeric,numeric,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.post_invoice_journal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_invoice_journal(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid,uuid,numeric,public.payment_method,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(uuid,uuid,numeric,public.payment_method,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_receipt_with_payment(uuid,uuid,uuid,numeric,public.payment_method,uuid,text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_receipt_with_payment(uuid,uuid,uuid,numeric,public.payment_method,uuid,text,text,text,text,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
