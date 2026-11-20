-- Make customer credit-note, application and refund retry tokens tenant-scoped.
ALTER TABLE public.credit_notes
  DROP CONSTRAINT IF EXISTS credit_notes_idempotency_key_key;
ALTER TABLE public.customer_credit_applications
  DROP CONSTRAINT IF EXISTS customer_credit_applications_idempotency_key_key;
ALTER TABLE public.customer_credit_refunds
  DROP CONSTRAINT IF EXISTS customer_credit_refunds_idempotency_key_key;

CREATE UNIQUE INDEX credit_notes_business_idempotency_uidx
  ON public.credit_notes (business_id, idempotency_key);
CREATE UNIQUE INDEX customer_credit_applications_business_idempotency_uidx
  ON public.customer_credit_applications (business_id, idempotency_key);
CREATE UNIQUE INDEX customer_credit_refunds_business_idempotency_uidx
  ON public.customer_credit_refunds (business_id, idempotency_key);

CREATE OR REPLACE FUNCTION public.record_invoice_credit_note(
  p_invoice_id uuid,
  p_lines jsonb,
  p_credit_note_date date,
  p_reason text,
  p_reference_number text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $record_invoice_credit_note$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_invoice public.invoices%ROWTYPE;
  v_item public.invoice_items%ROWTYPE;
  v_tax record;
  v_request record;
  v_credit_note_id uuid := gen_random_uuid();
  v_credit_note_number text;
  v_existing_id uuid;
  v_existing_fingerprint text;
  v_fingerprint text;
  v_net numeric(15,2);
  v_tax_total numeric(15,2);
  v_line_tax numeric(15,2);
  v_taxable numeric(15,2);
  v_prev_qty numeric(15,3);
  v_remaining_qty numeric(15,3);
  v_prev_net numeric(15,2);
  v_prev_tax numeric(15,2);
  v_prev_taxable numeric(15,2);
  v_inventory_cost numeric(15,2);
  v_unit_cost numeric(14,4);
  v_previous_quantity integer;
  v_new_quantity integer;
  v_previous_cost numeric(14,4);
  v_new_cost numeric(14,4);
  v_current_cost_verified boolean;
  v_is_service boolean;
  v_is_inventory boolean;
  v_subtotal numeric(15,2) := 0;
  v_total_tax numeric(15,2) := 0;
  v_total_amount numeric(15,2) := 0;
  v_total_inventory_cost numeric(15,2) := 0;
  v_receivable_applied numeric(15,2) := 0;
  v_customer_credit numeric(15,2) := 0;
  v_ar_account uuid;
  v_revenue_account uuid;
  v_customer_credit_account uuid;
  v_inventory_account uuid;
  v_cogs_account uuid;
  v_journal_id uuid;
  v_entry_number text;
  v_currency text;
  v_line_number integer := 1;
  v_debits numeric(15,2);
  v_credits numeric(15,2);
  v_note_line_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL OR NOT public.has_business_role(
    v_business_id, ARRAY['owner','admin','accountant']::text[]
  ) THEN
    RAISE EXCEPTION 'Only an active business owner, admin or accountant can issue customer credit notes' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL OR p_credit_note_date IS NULL OR p_idempotency_key IS NULL
     OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Invoice, credit date, idempotency key and at least one credit line are required';
  END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL OR NULLIF(BTRIM(p_reference_number), '') IS NULL THEN
    RAISE EXCEPTION 'A reason and supporting reference are required for every credit note';
  END IF;

  v_fingerprint := md5(p_invoice_id::text || '|' || p_lines::text || '|' ||
    p_credit_note_date::text || '|' || BTRIM(p_reason) || '|' || BTRIM(p_reference_number));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':' || p_idempotency_key::text, 0));
  SELECT id, request_fingerprint INTO v_existing_id, v_existing_fingerprint
  FROM public.credit_notes WHERE business_id = v_business_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This credit-note idempotency key was already used with different details';
    END IF;
    RETURN v_existing_id;
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_invoice.status NOT IN ('issued','partially_paid','paid','overdue') THEN
    RAISE EXCEPTION 'Credit notes can only be issued against an active issued invoice';
  END IF;
  IF p_credit_note_date < v_invoice.issue_date THEN
    RAISE EXCEPTION 'Credit note date cannot be earlier than the original invoice date';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE source_type = 'invoice' AND source_id = p_invoice_id
  ) THEN
    RAISE EXCEPTION 'The original invoice must have a posted journal before it can be credited';
  END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(p_lines)) <>
     (SELECT count(DISTINCT (value->>'invoice_item_id')) FROM jsonb_array_elements(p_lines)) THEN
    RAISE EXCEPTION 'Each original invoice line may appear only once per credit note';
  END IF;

  PERFORM set_config('app.credit_note_rpc', 'on', true);

  v_credit_note_number := 'CN-' || upper(substr(replace(v_credit_note_id::text, '-', ''), 1, 12));
  INSERT INTO public.credit_notes (
    id, business_id, credit_note_number, invoice_id, customer_id, credit_note_date,
    reason, reference_number, idempotency_key, request_fingerprint, created_by
  ) VALUES (
    v_credit_note_id, v_business_id, v_credit_note_number, v_invoice.id, v_invoice.customer_id,
    p_credit_note_date, BTRIM(p_reason), BTRIM(p_reference_number),
    p_idempotency_key, v_fingerprint, auth.uid()
  );

  FOR v_request IN
    SELECT * FROM jsonb_to_recordset(p_lines) AS x(invoice_item_id uuid, quantity numeric)
    ORDER BY invoice_item_id
  LOOP
    IF v_request.invoice_item_id IS NULL OR v_request.quantity IS NULL OR v_request.quantity <= 0
       OR v_request.quantity <> ROUND(v_request.quantity,3) THEN
      RAISE EXCEPTION 'Every credit line requires a valid invoice item and a positive quantity with at most three decimal places';
    END IF;

    SELECT * INTO v_item
    FROM public.invoice_items
    WHERE id = v_request.invoice_item_id AND invoice_id = v_invoice.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected credit line does not belong to the original invoice';
    END IF;

    SELECT COALESCE(p.is_service, false)
    INTO v_is_service
    FROM public.products p
    WHERE p.id = v_item.product_id;
    v_is_service := COALESCE(v_is_service, false);
    v_is_inventory := v_item.product_id IS NOT NULL AND NOT v_is_service;

    SELECT COALESCE(SUM(cnl.quantity),0), COALESCE(SUM(cnl.net_amount),0)
    INTO v_prev_qty, v_prev_net
    FROM public.credit_note_lines cnl
    WHERE cnl.invoice_item_id = v_item.id;

    v_remaining_qty := v_item.quantity - v_prev_qty;
    IF v_request.quantity > v_remaining_qty THEN
      RAISE EXCEPTION 'Credit quantity exceeds the uncredited quantity remaining for invoice line %', v_item.id;
    END IF;

    IF v_item.line_total < v_item.tax_amount THEN
      RAISE EXCEPTION 'Original invoice line totals are invalid and cannot be credited';
    END IF;
    v_net := ROUND(v_item.line_total - v_item.tax_amount, 2);
    IF v_net < v_prev_net THEN
      RAISE EXCEPTION 'Previously issued credits exceed the original invoice line value';
    END IF;
    IF v_request.quantity = v_remaining_qty THEN
      v_net := ROUND(v_net - v_prev_net, 2);
    ELSE
      v_net := ROUND((v_net * v_request.quantity) / NULLIF(v_item.quantity,0), 2);
    END IF;

    SELECT COALESCE(SUM(tax_amount),0), COUNT(*)
    INTO v_prev_tax, v_tax_total
    FROM public.invoice_item_taxes
    WHERE invoice_item_id = v_item.id;
    IF ROUND(v_prev_tax,2) <> ROUND(COALESCE(v_item.tax_amount,0),2)
       AND (v_prev_tax > 0 OR v_item.tax_amount > 0) THEN
      RAISE EXCEPTION 'This invoice line lacks reconciled per-line tax evidence; reconstruct the tax allocation before issuing a credit note';
    END IF;
    IF v_item.tax_amount > 0 AND v_tax_total = 0 THEN
      RAISE EXCEPTION 'Historical taxed invoice lines without per-line tax snapshots cannot be credited';
    END IF;

    v_line_tax := 0;
    FOR v_tax IN
      SELECT * FROM public.invoice_item_taxes
      WHERE invoice_item_id = v_item.id
      ORDER BY tax_order, tax_code
    LOOP
      SELECT COALESCE(SUM(cnt.tax_amount),0), COALESCE(SUM(cnt.taxable_amount),0)
      INTO v_prev_tax, v_prev_taxable
      FROM public.credit_note_line_taxes cnt
      JOIN public.credit_note_lines cnl ON cnl.id = cnt.credit_note_line_id
      WHERE cnl.invoice_item_id = v_item.id
        AND cnt.source_invoice_item_tax_id = v_tax.id;

      IF v_request.quantity = v_remaining_qty THEN
        v_tax_total := ROUND(v_tax.tax_amount - v_prev_tax,2);
        v_taxable := ROUND(v_tax.taxable_amount - v_prev_taxable,2);
      ELSE
        v_tax_total := ROUND(v_tax.tax_amount * v_request.quantity / NULLIF(v_item.quantity,0),2);
        v_taxable := ROUND(v_tax.taxable_amount * v_request.quantity / NULLIF(v_item.quantity,0),2);
      END IF;
      IF v_tax_total < 0 OR v_taxable < 0 THEN
        RAISE EXCEPTION 'Previously issued tax credits exceed the original tax allocation';
      END IF;
      v_line_tax := v_line_tax + v_tax_total;
    END LOOP;

    IF ROUND(v_line_tax,2) <> ROUND(
      CASE WHEN v_request.quantity = v_remaining_qty
        THEN v_item.tax_amount - COALESCE((
          SELECT SUM(cnl.tax_amount) FROM public.credit_note_lines cnl
          WHERE cnl.invoice_item_id = v_item.id
        ),0)
        ELSE ROUND(v_item.tax_amount * v_request.quantity / NULLIF(v_item.quantity,0),2)
      END, 2
    ) THEN
      RAISE EXCEPTION 'Per-line tax snapshots do not reconcile to the credit quantity allocation';
    END IF;

    v_inventory_cost := 0;
    v_unit_cost := NULL;
    IF v_is_inventory THEN
      IF v_item.quantity <> trunc(v_item.quantity) OR v_request.quantity <> trunc(v_request.quantity) THEN
        RAISE EXCEPTION 'Physical inventory returns must use whole-unit quantities';
      END IF;
      IF v_item.unit_cost IS NULL OR v_item.unit_cost < 0 THEN
        RAISE EXCEPTION 'This physical invoice line has no verified historical unit cost; verify cost before accepting a stock return';
      END IF;
      v_unit_cost := v_item.unit_cost;
      v_inventory_cost := ROUND(v_request.quantity * v_unit_cost,2);
    END IF;

    INSERT INTO public.credit_note_lines (
      credit_note_id, invoice_item_id, product_id, description, quantity,
      net_amount, tax_amount, total_amount, is_inventory_item, unit_cost, inventory_cost
    ) VALUES (
      v_credit_note_id, v_item.id, v_item.product_id, v_item.description,
      v_request.quantity, v_net, v_line_tax, v_net + v_line_tax,
      v_is_inventory, v_unit_cost, v_inventory_cost
    ) RETURNING id INTO v_note_line_id;

    FOR v_tax IN
      SELECT * FROM public.invoice_item_taxes
      WHERE invoice_item_id = v_item.id
      ORDER BY tax_order, tax_code
    LOOP
      SELECT COALESCE(SUM(cnt.tax_amount),0), COALESCE(SUM(cnt.taxable_amount),0)
      INTO v_prev_tax, v_prev_taxable
      FROM public.credit_note_line_taxes cnt
      JOIN public.credit_note_lines cnl ON cnl.id = cnt.credit_note_line_id
      WHERE cnl.invoice_item_id = v_item.id
        AND cnt.source_invoice_item_tax_id = v_tax.id
        AND cnl.credit_note_id <> v_credit_note_id;

      IF v_request.quantity = v_remaining_qty THEN
        v_tax_total := ROUND(v_tax.tax_amount - v_prev_tax,2);
        v_taxable := ROUND(v_tax.taxable_amount - v_prev_taxable,2);
      ELSE
        v_tax_total := ROUND(v_tax.tax_amount * v_request.quantity / NULLIF(v_item.quantity,0),2);
        v_taxable := ROUND(v_tax.taxable_amount * v_request.quantity / NULLIF(v_item.quantity,0),2);
      END IF;

      INSERT INTO public.credit_note_line_taxes (
        credit_note_line_id, source_invoice_item_tax_id, tax_id, tax_name,
        tax_code, tax_rate, is_compound, tax_order, taxable_amount,
        tax_amount, liability_account_id
      ) VALUES (
        v_note_line_id, v_tax.id, v_tax.tax_id, v_tax.tax_name,
        v_tax.tax_code, v_tax.tax_rate, v_tax.is_compound, v_tax.tax_order,
        v_taxable, v_tax_total, v_tax.liability_account_id
      );
    END LOOP;

    v_subtotal := v_subtotal + v_net;
    v_total_tax := v_total_tax + v_line_tax;
    v_total_inventory_cost := v_total_inventory_cost + v_inventory_cost;
  END LOOP;

  v_total_amount := ROUND(v_subtotal + v_total_tax,2);
  IF v_total_amount <= 0 AND v_total_inventory_cost <= 0 THEN
    RAISE EXCEPTION 'Credit note has no financial or inventory value';
  END IF;

  v_receivable_applied := LEAST(v_total_amount, GREATEST(0,ROUND(COALESCE(v_invoice.balance_due,0),2)));
  v_customer_credit := ROUND(v_total_amount - v_receivable_applied,2);

  UPDATE public.credit_notes
  SET subtotal = v_subtotal, tax_amount = v_total_tax, total_amount = v_total_amount,
      receivable_applied = v_receivable_applied, customer_credit_amount = v_customer_credit
  WHERE id = v_credit_note_id;

  SELECT id INTO v_ar_account FROM public.chart_of_accounts
  WHERE code='1100' AND account_type='asset' AND is_active LIMIT 1;
  SELECT id INTO v_revenue_account FROM public.chart_of_accounts
  WHERE code='4000' AND account_type='revenue' AND is_active LIMIT 1;
  SELECT id INTO v_customer_credit_account FROM public.chart_of_accounts
  WHERE code='2200' AND account_type='liability' AND is_active LIMIT 1;
  SELECT id INTO v_inventory_account FROM public.chart_of_accounts
  WHERE code='1200' AND account_type='asset' AND is_active LIMIT 1;
  SELECT id INTO v_cogs_account FROM public.chart_of_accounts
  WHERE code='5000' AND account_type='expense' AND is_active LIMIT 1;
  IF v_ar_account IS NULL OR v_revenue_account IS NULL OR v_customer_credit_account IS NULL
     OR (v_total_inventory_cost > 0 AND (v_inventory_account IS NULL OR v_cogs_account IS NULL)) THEN
    RAISE EXCEPTION 'Required revenue, receivable, customer credit, inventory or COGS accounts are not configured';
  END IF;

  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code,'USD') INTO v_currency
  FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency := COALESCE(v_currency,'USD');

  INSERT INTO public.journal_entries (
    entry_number, entry_date, description, source_type, source_id, currency, created_by
  ) VALUES (
    v_entry_number, p_credit_note_date,
    'Credit note ' || v_credit_note_number || ' against invoice ' || v_invoice.invoice_number,
    'credit_note', v_credit_note_id, v_currency, auth.uid()
  ) RETURNING id INTO v_journal_id;

  IF v_subtotal > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id,line_number,account_id,description,debit,credit
    ) VALUES (
      v_journal_id,v_line_number,v_revenue_account,
      'Sales revenue reversal - ' || v_credit_note_number,v_subtotal,0
    );
    v_line_number := v_line_number + 1;
  END IF;

  FOR v_tax IN
    SELECT liability_account_id, ROUND(SUM(tax_amount),2) AS tax_amount
    FROM public.credit_note_line_taxes
    WHERE credit_note_line_id IN (SELECT id FROM public.credit_note_lines WHERE credit_note_id=v_credit_note_id)
    GROUP BY liability_account_id
    ORDER BY liability_account_id
  LOOP
    IF v_tax.tax_amount > 0 THEN
      INSERT INTO public.journal_lines (
        journal_entry_id,line_number,account_id,description,debit,credit
      ) VALUES (
        v_journal_id,v_line_number,v_tax.liability_account_id,
        'Sales tax reversal - ' || v_credit_note_number,v_tax.tax_amount,0
      );
      v_line_number := v_line_number + 1;
    END IF;
  END LOOP;

  IF v_receivable_applied > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id,line_number,account_id,description,debit,credit
    ) VALUES (
      v_journal_id,v_line_number,v_ar_account,
      'Accounts receivable credited - ' || v_credit_note_number,0,v_receivable_applied
    );
    v_line_number := v_line_number + 1;
  END IF;
  IF v_customer_credit > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id,line_number,account_id,description,debit,credit
    ) VALUES (
      v_journal_id,v_line_number,v_customer_credit_account,
      'Customer credit liability - ' || v_credit_note_number,0,v_customer_credit
    );
    v_line_number := v_line_number + 1;
  END IF;
  IF v_total_inventory_cost > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id,line_number,account_id,description,debit,credit
    ) VALUES
      (v_journal_id,v_line_number,v_inventory_account,'Returned inventory - ' || v_credit_note_number,v_total_inventory_cost,0),
      (v_journal_id,v_line_number+1,v_cogs_account,'Reverse cost of goods sold - ' || v_credit_note_number,0,v_total_inventory_cost);
  END IF;

  SELECT ROUND(COALESCE(SUM(debit),0),2), ROUND(COALESCE(SUM(credit),0),2)
  INTO v_debits,v_credits FROM public.journal_lines WHERE journal_entry_id=v_journal_id;
  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'Credit-note journal is not balanced (debits %, credits %)',v_debits,v_credits;
  END IF;

  UPDATE public.invoices
  SET balance_due = GREATEST(0,ROUND(COALESCE(balance_due,0)-v_receivable_applied,2))
  WHERE id = v_invoice.id;

  -- Stock is restored only for physical goods with verified original invoice cost.
  PERFORM set_config('app.inventory_adjustment_rpc','on',true);
  FOR v_request IN
    SELECT product_id, SUM(quantity)::integer AS quantity,
           ROUND(SUM(inventory_cost),2) AS total_cost,
           CASE WHEN SUM(quantity) > 0 THEN ROUND(SUM(inventory_cost)/SUM(quantity),4) ELSE 0 END AS unit_cost
    FROM public.credit_note_lines
    WHERE credit_note_id=v_credit_note_id AND is_inventory_item
    GROUP BY product_id
    ORDER BY product_id
  LOOP
    SELECT COALESCE(stock_quantity,0),cost_price,cost_price_verified
    INTO v_previous_quantity,v_previous_cost,v_current_cost_verified
    FROM public.products WHERE id=v_request.product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Returned product no longer exists'; END IF;
    IF v_previous_quantity > 0 AND (NOT COALESCE(v_current_cost_verified,false) OR v_previous_cost IS NULL) THEN
      RAISE EXCEPTION 'Current stock valuation is unverified; reconcile inventory cost before posting a physical stock return';
    END IF;
    v_new_quantity := v_previous_quantity + v_request.quantity;
    IF v_previous_quantity = 0 THEN
      v_new_cost := v_request.unit_cost;
    ELSE
      v_new_cost := ROUND(
        ((v_previous_quantity * v_previous_cost) + (v_request.quantity * v_request.unit_cost))
        / NULLIF(v_new_quantity,0),
        4
      );
    END IF;

    UPDATE public.products
    SET stock_quantity = v_new_quantity,
        cost_price = v_new_cost,
        cost_price_verified = true
    WHERE id=v_request.product_id;

    INSERT INTO public.inventory_transactions (
      product_id,type,quantity,previous_quantity,new_quantity,unit_cost,total_cost,
      reference_id,reference_type,reference_number,notes,performed_by,idempotency_key
    ) VALUES (
      v_request.product_id,'return',v_request.quantity,v_previous_quantity,
      v_new_quantity,v_request.unit_cost,v_request.total_cost,
      v_credit_note_id,'credit_note',v_credit_note_number,
      'Returned against invoice ' || v_invoice.invoice_number || ': ' || BTRIM(p_reason),
      auth.uid(),gen_random_uuid()
    );
  END LOOP;

  UPDATE public.credit_notes SET journal_entry_id=v_journal_id WHERE id=v_credit_note_id;
  RETURN v_credit_note_id;
END;
$record_invoice_credit_note$;

CREATE OR REPLACE FUNCTION public.apply_customer_credit(
  p_credit_note_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_applied_on date,
  p_reference_number text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $apply_customer_credit$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_note public.credit_notes%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_application_id uuid := gen_random_uuid();
  v_journal_id uuid;
  v_entry_number text;
  v_ar_account uuid;
  v_credit_account uuid;
  v_currency text;
  v_remaining numeric(15,2);
  v_fingerprint text;
  v_existing_id uuid;
  v_existing_fingerprint text;
  v_debits numeric(15,2);
  v_credits numeric(15,2);
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL OR NOT public.has_business_role(
    v_business_id, ARRAY['owner','admin','accountant']::text[]
  ) THEN
    RAISE EXCEPTION 'Only an active business owner, admin or accountant can apply customer credit' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> ROUND(p_amount,2) OR p_applied_on IS NULL
     OR p_idempotency_key IS NULL OR NULLIF(BTRIM(p_reference_number),'') IS NULL THEN
    RAISE EXCEPTION 'A positive amount, date, reference and idempotency key are required';
  END IF;
  v_fingerprint := md5(p_credit_note_id::text||'|'||p_invoice_id::text||'|'||p_amount::text||'|'||p_applied_on::text||'|'||BTRIM(p_reference_number));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':' || p_idempotency_key::text, 0));
  SELECT id,request_fingerprint INTO v_existing_id,v_existing_fingerprint
  FROM public.customer_credit_applications WHERE business_id=v_business_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This customer-credit application key was reused with different details';
    END IF;
    RETURN v_existing_id;
  END IF;

  SELECT * INTO v_note FROM public.credit_notes WHERE id=p_credit_note_id FOR UPDATE;
  IF NOT FOUND OR v_note.customer_credit_amount <= 0 THEN
    RAISE EXCEPTION 'The selected credit note has no customer credit balance';
  END IF;
  SELECT COALESCE(v_note.customer_credit_amount,0)
    - COALESCE((SELECT SUM(amount) FROM public.customer_credit_applications WHERE credit_note_id=v_note.id),0)
    - COALESCE((SELECT SUM(amount) FROM public.customer_credit_refunds WHERE credit_note_id=v_note.id),0)
  INTO v_remaining;
  IF p_amount > v_remaining THEN RAISE EXCEPTION 'Application exceeds the remaining customer credit'; END IF;
  IF p_applied_on < v_note.credit_note_date THEN
    RAISE EXCEPTION 'Customer credit application date cannot be earlier than the credit note';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices
  WHERE id=p_invoice_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_invoice.customer_id<>v_note.customer_id
     OR v_invoice.status NOT IN ('issued','partially_paid','overdue') THEN
    RAISE EXCEPTION 'Select an active outstanding invoice belonging to the same customer';
  END IF;
  IF p_applied_on < v_invoice.issue_date THEN
    RAISE EXCEPTION 'Customer credit application date cannot be earlier than the target invoice';
  END IF;
  IF p_amount > COALESCE(v_invoice.balance_due,0) THEN
    RAISE EXCEPTION 'Application exceeds the selected invoice balance';
  END IF;

  PERFORM set_config('app.customer_credit_settlement_rpc','on',true);
  INSERT INTO public.customer_credit_applications (
    id,business_id,credit_note_id,applied_to_invoice_id,amount,applied_on,reference_number,
    idempotency_key,request_fingerprint,created_by
  ) VALUES (
    v_application_id,v_business_id,v_note.id,v_invoice.id,ROUND(p_amount,2),
    BTRIM(p_reference_number),p_idempotency_key,v_fingerprint,auth.uid()
  );

  SELECT id INTO v_ar_account FROM public.chart_of_accounts
  WHERE code='1100' AND account_type='asset' AND is_active LIMIT 1;
  SELECT id INTO v_credit_account FROM public.chart_of_accounts
  WHERE code='2200' AND account_type='liability' AND is_active LIMIT 1;
  IF v_ar_account IS NULL OR v_credit_account IS NULL THEN
    RAISE EXCEPTION 'Accounts receivable or customer credit liability account is not configured';
  END IF;

  v_entry_number:=public.get_next_sequence('journal');
  SELECT COALESCE(currency_code,'USD') INTO v_currency FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency:=COALESCE(v_currency,'USD');
  INSERT INTO public.journal_entries(entry_number,entry_date,description,source_type,source_id,currency,created_by)
  VALUES(v_entry_number,p_applied_on,'Customer credit applied to invoice','customer_credit_application',v_application_id,v_currency,auth.uid())
  RETURNING id INTO v_journal_id;
  INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
  VALUES
    (v_journal_id,1,v_credit_account,'Customer credit applied',ROUND(p_amount,2),0),
    (v_journal_id,2,v_ar_account,'Accounts receivable settled by customer credit',0,ROUND(p_amount,2));

  SELECT ROUND(SUM(debit),2),ROUND(SUM(credit),2) INTO v_debits,v_credits
  FROM public.journal_lines WHERE journal_entry_id=v_journal_id;
  IF v_debits<>v_credits THEN RAISE EXCEPTION 'Customer credit application journal is not balanced'; END IF;

  UPDATE public.invoices SET balance_due=GREATEST(0,ROUND(balance_due-p_amount,2)) WHERE id=v_invoice.id;
  UPDATE public.customer_credit_applications SET journal_entry_id=v_journal_id WHERE id=v_application_id;
  RETURN v_application_id;
END;
$apply_customer_credit$;

CREATE OR REPLACE FUNCTION public.refund_customer_credit(
  p_credit_note_id uuid,
  p_amount numeric,
  p_refunded_on date,
  p_payment_method public.payment_method,
  p_reference_number text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $refund_customer_credit$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_note public.credit_notes%ROWTYPE;
  v_refund_id uuid := gen_random_uuid();
  v_journal_id uuid;
  v_entry_number text;
  v_credit_account uuid;
  v_payment_account uuid;
  v_currency text;
  v_remaining numeric(15,2);
  v_fingerprint text;
  v_existing_id uuid;
  v_existing_fingerprint text;
  v_debits numeric(15,2);
  v_credits numeric(15,2);
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL OR NOT public.has_business_role(
    v_business_id, ARRAY['owner','admin','accountant']::text[]
  ) THEN
    RAISE EXCEPTION 'Only an active business owner, admin or accountant can refund customer credit' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_amount <> ROUND(p_amount,2) OR p_refunded_on IS NULL
     OR p_payment_method IS NULL OR p_idempotency_key IS NULL
     OR NULLIF(BTRIM(p_reference_number),'') IS NULL THEN
    RAISE EXCEPTION 'A positive refund, date, payment method, reference and idempotency key are required';
  END IF;
  IF p_payment_method NOT IN (
    'cash'::public.payment_method,
    'bank_transfer'::public.payment_method,
    'mobile_payment'::public.payment_method
  ) THEN
    RAISE EXCEPTION 'Customer-credit refunds must use cash, bank transfer or mobile payment';
  END IF;
  v_fingerprint:=md5(p_credit_note_id::text||'|'||p_amount::text||'|'||p_refunded_on::text||'|'||p_payment_method::text||'|'||BTRIM(p_reference_number));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':' || p_idempotency_key::text, 0));
  SELECT id,request_fingerprint INTO v_existing_id,v_existing_fingerprint
  FROM public.customer_credit_refunds WHERE business_id=v_business_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This customer-credit refund key was reused with different details';
    END IF;
    RETURN v_existing_id;
  END IF;

  SELECT * INTO v_note FROM public.credit_notes WHERE id=p_credit_note_id FOR UPDATE;
  IF NOT FOUND OR v_note.customer_credit_amount<=0 THEN
    RAISE EXCEPTION 'The selected credit note has no refundable customer credit';
  END IF;
  IF p_refunded_on < v_note.credit_note_date THEN
    RAISE EXCEPTION 'Refund date cannot be earlier than the credit note';
  END IF;
  SELECT COALESCE(v_note.customer_credit_amount,0)
    - COALESCE((SELECT SUM(amount) FROM public.customer_credit_applications WHERE credit_note_id=v_note.id),0)
    - COALESCE((SELECT SUM(amount) FROM public.customer_credit_refunds WHERE credit_note_id=v_note.id),0)
  INTO v_remaining;
  IF p_amount>v_remaining THEN RAISE EXCEPTION 'Refund exceeds the remaining customer credit'; END IF;

  PERFORM set_config('app.customer_credit_settlement_rpc','on',true);
  INSERT INTO public.customer_credit_refunds(
    id,business_id,credit_note_id,amount,refunded_on,payment_method,reference_number,
    idempotency_key,request_fingerprint,created_by
  ) VALUES (
    v_refund_id,v_business_id,v_note.id,ROUND(p_amount,2),p_refunded_on,p_payment_method,
    BTRIM(p_reference_number),p_idempotency_key,v_fingerprint,auth.uid()
  );

  SELECT id INTO v_credit_account FROM public.chart_of_accounts
  WHERE code='2200' AND account_type='liability' AND is_active LIMIT 1;
  IF p_payment_method='cash' THEN
    SELECT id INTO v_payment_account FROM public.chart_of_accounts
    WHERE code='1000' AND account_type='asset' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_payment_account FROM public.chart_of_accounts
    WHERE code='1010' AND account_type='asset' AND is_active LIMIT 1;
  END IF;
  IF v_credit_account IS NULL OR v_payment_account IS NULL THEN
    RAISE EXCEPTION 'Customer credit liability or cash/bank account is not configured';
  END IF;

  v_entry_number:=public.get_next_sequence('journal');
  SELECT COALESCE(currency_code,'USD') INTO v_currency FROM public.company_settings ORDER BY created_at LIMIT 1;
  v_currency:=COALESCE(v_currency,'USD');
  INSERT INTO public.journal_entries(entry_number,entry_date,description,source_type,source_id,currency,created_by)
  VALUES(v_entry_number,p_refunded_on,'Customer credit refund','customer_credit_refund',v_refund_id,v_currency,auth.uid())
  RETURNING id INTO v_journal_id;
  INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
  VALUES
    (v_journal_id,1,v_credit_account,'Customer credit liability settled',ROUND(p_amount,2),0),
    (v_journal_id,2,v_payment_account,'Customer refund paid',0,ROUND(p_amount,2));

  SELECT ROUND(SUM(debit),2),ROUND(SUM(credit),2) INTO v_debits,v_credits
  FROM public.journal_lines WHERE journal_entry_id=v_journal_id;
  IF v_debits<>v_credits THEN RAISE EXCEPTION 'Customer credit refund journal is not balanced'; END IF;

  UPDATE public.customer_credit_refunds SET journal_entry_id=v_journal_id WHERE id=v_refund_id;
  RETURN v_refund_id;
END;
$refund_customer_credit$;

NOTIFY pgrst, 'reload schema';
