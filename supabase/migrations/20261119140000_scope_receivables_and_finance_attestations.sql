-- Tenant-aware receivables, customer credits and finance completeness attestations.
-- These SECURITY DEFINER routines must scope every contributing record to the
-- authenticated user's active business; frontend cache keys are not security.

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
DECLARE
  v_business_id uuid := public.current_business_id();
BEGIN
  IF v_business_id IS NULL OR NOT public.has_business_role(
    v_business_id, ARRAY['owner','admin','accountant','auditor','cashier']::text[]
  ) THEN
    RAISE EXCEPTION 'You are not authorized to view customer account balances'
      USING ERRCODE = '42501';
  END IF;
  IF p_as_of_date IS NULL THEN
    RAISE EXCEPTION 'An as-at date is required';
  END IF;

  RETURN QUERY
  WITH issued_invoices AS (
    SELECT i.id,i.customer_id,i.issue_date,ROUND(COALESCE(i.total_amount,0),2) AS total_amount
    FROM public.invoices i
    WHERE i.business_id = v_business_id
      AND i.deleted_at IS NULL
      AND i.issue_date <= p_as_of_date
      AND EXISTS (
        SELECT 1 FROM public.journal_entries issued_entry
        WHERE issued_entry.business_id = v_business_id
          AND issued_entry.source_type = 'invoice'
          AND issued_entry.source_id = i.id
          AND issued_entry.entry_date <= p_as_of_date
      )
      AND (p_customer_id IS NULL OR i.customer_id = p_customer_id)
  ),
  invoice_payments AS (
    SELECT settled.invoice_id,ROUND(SUM(settled.amount),2) AS amount
    FROM (
      SELECT p.invoice_id,p.amount
      FROM public.payments p
      WHERE p.business_id = v_business_id
        AND p.deleted_at IS NULL
        AND p.payment_date::date <= p_as_of_date
      UNION ALL
      SELECT r.invoice_id,r.amount
      FROM public.receipts r
      WHERE r.business_id = v_business_id
        AND r.deleted_at IS NULL
        AND r.status = 'issued'
        AND r.invoice_id IS NOT NULL
        AND r.payment_id IS NULL
        AND r.issue_date::date <= p_as_of_date
    ) settled
    JOIN issued_invoices i ON i.id = settled.invoice_id
    GROUP BY settled.invoice_id
  ),
  invoice_credit_notes AS (
    SELECT cn.invoice_id,ROUND(SUM(cn.receivable_applied),2) AS amount
    FROM public.credit_notes cn
    JOIN issued_invoices i ON i.id = cn.invoice_id
    WHERE cn.business_id = v_business_id
      AND cn.credit_note_date <= p_as_of_date
    GROUP BY cn.invoice_id
  ),
  invoice_credit_applications AS (
    SELECT cca.applied_to_invoice_id AS invoice_id,ROUND(SUM(cca.amount),2) AS amount
    FROM public.customer_credit_applications cca
    JOIN issued_invoices i ON i.id = cca.applied_to_invoice_id
    WHERE cca.business_id = v_business_id
      AND cca.applied_on <= p_as_of_date
    GROUP BY cca.applied_to_invoice_id
  ),
  invoice_balances AS (
    SELECT i.customer_id,i.total_amount,
      COALESCE(p.amount,0) AS paid_amount,
      COALESCE(cn.amount,0) AS credit_note_amount,
      COALESCE(ca.amount,0) AS credit_application_amount,
      GREATEST(0,ROUND(i.total_amount-COALESCE(p.amount,0)-COALESCE(cn.amount,0)-COALESCE(ca.amount,0),2)) AS balance
    FROM issued_invoices i
    LEFT JOIN invoice_payments p ON p.invoice_id = i.id
    LEFT JOIN invoice_credit_notes cn ON cn.invoice_id = i.id
    LEFT JOIN invoice_credit_applications ca ON ca.invoice_id = i.id
  )
  SELECT c.id,c.code,c.name,
    ROUND(COALESCE(SUM(ib.total_amount),0),2)::numeric(15,2),
    ROUND(COALESCE(SUM(ib.paid_amount),0),2)::numeric(15,2),
    ROUND(COALESCE(SUM(ib.credit_note_amount),0),2)::numeric(15,2),
    ROUND(COALESCE(SUM(ib.credit_application_amount),0),2)::numeric(15,2),
    ROUND(COALESCE(SUM(ib.balance),0),2)::numeric(15,2),
    p_as_of_date
  FROM public.customers c
  LEFT JOIN invoice_balances ib ON ib.customer_id = c.id
  WHERE c.business_id = v_business_id
    AND c.deleted_at IS NULL
    AND (p_customer_id IS NULL OR c.id = p_customer_id)
  GROUP BY c.id,c.code,c.name
  ORDER BY c.name;
END;
$customer_account_balances$;

CREATE OR REPLACE FUNCTION public.get_customer_credit_balances(p_customer_id uuid)
RETURNS TABLE(
  credit_note_id uuid,
  credit_note_number text,
  original_invoice_id uuid,
  original_invoice_number text,
  credit_note_date date,
  reason text,
  credit_amount numeric,
  applied_amount numeric,
  refunded_amount numeric,
  remaining_amount numeric,
  can_manage boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $customer_credit_balances$
DECLARE
  v_business_id uuid := public.current_business_id();
BEGIN
  IF v_business_id IS NULL OR NOT public.has_business_role(
    v_business_id, ARRAY['owner','admin','accountant','auditor']::text[]
  ) THEN
    RAISE EXCEPTION 'You are not authorized to view customer credit balances'
      USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required to retrieve customer credit balances';
  END IF;

  RETURN QUERY
  SELECT
    cn.id,
    cn.credit_note_number,
    cn.invoice_id,
    i.invoice_number,
    cn.credit_note_date,
    cn.reason,
    cn.customer_credit_amount::numeric(15,2),
    COALESCE(app.applied_amount,0)::numeric(15,2),
    COALESCE(ref.refunded_amount,0)::numeric(15,2),
    GREATEST(cn.customer_credit_amount-COALESCE(app.applied_amount,0)-COALESCE(ref.refunded_amount,0),0)::numeric(15,2),
    public.has_business_role(v_business_id, ARRAY['owner','admin','accountant']::text[])
  FROM public.credit_notes cn
  JOIN public.invoices i
    ON i.id = cn.invoice_id
   AND i.business_id = v_business_id
  LEFT JOIN (
    SELECT cca.credit_note_id,SUM(cca.amount) AS applied_amount
    FROM public.customer_credit_applications cca
    WHERE cca.business_id = v_business_id
    GROUP BY cca.credit_note_id
  ) app ON app.credit_note_id = cn.id
  LEFT JOIN (
    SELECT ccr.credit_note_id,SUM(ccr.amount) AS refunded_amount
    FROM public.customer_credit_refunds ccr
    WHERE ccr.business_id = v_business_id
    GROUP BY ccr.credit_note_id
  ) ref ON ref.credit_note_id = cn.id
  WHERE cn.business_id = v_business_id
    AND cn.customer_id = p_customer_id
    AND cn.customer_credit_amount > 0
  ORDER BY cn.credit_note_date DESC,cn.created_at DESC;
END;
$customer_credit_balances$;

-- Internal, business-specific digest. It is executable only by the restricted
-- RPC owner and is called after the public RPC has checked active membership.
CREATE OR REPLACE FUNCTION public.financial_completeness_evidence_digest(
  p_through_date date,
  p_business_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $financial_digest$
DECLARE
  v_journal_digest text;
  v_cost_digest text;
BEGIN
  IF p_through_date IS NULL OR p_business_id IS NULL THEN
    RAISE EXCEPTION 'An attestation date and business are required';
  END IF;

  SELECT md5(COALESCE(string_agg(
    concat_ws('|',
      je.id::text,je.entry_date::text,je.source_type,
      COALESCE(je.source_id::text,''),COALESCE(je.currency,''),
      COALESCE(lines.line_digest,'')
    ),
    E'\\n' ORDER BY je.id::text
  ),''))
  INTO v_journal_digest
  FROM public.journal_entries je
  LEFT JOIN LATERAL (
    SELECT string_agg(
      concat_ws(':',jl.line_number::text,jl.account_id::text,
        round(jl.debit,2)::text,round(jl.credit,2)::text),
      ',' ORDER BY jl.line_number
    ) AS line_digest
    FROM public.journal_lines jl
    WHERE jl.journal_entry_id = je.id
      AND jl.business_id = p_business_id
  ) lines ON true
  WHERE je.business_id = p_business_id
    AND je.entry_date <= p_through_date;

  SELECT md5(COALESCE(string_agg(
    concat_ws('|',
      i.id::text,i.issue_date::text,ii.id::text,
      COALESCE(ii.product_id::text,''),ii.quantity::text,
      COALESCE(ii.unit_cost::text,''),COALESCE(p.is_service::text,'false'),
      COALESCE(dc.id::text,''),COALESCE(dc.amount::text,''),
      COALESCE(dc.source_reference,''),COALESCE(dc.incurred_on::text,''),
      COALESCE(dc.payment_method::text,''),COALESCE(dc.journal_entry_id::text,'')
    ),
    E'\\n' ORDER BY ii.id::text
  ),''))
  INTO v_cost_digest
  FROM public.invoices i
  JOIN public.invoice_items ii
    ON ii.invoice_id = i.id
   AND ii.business_id = p_business_id
  LEFT JOIN public.products p
    ON p.id = ii.product_id
   AND p.business_id = p_business_id
  LEFT JOIN public.invoice_item_direct_costs dc
    ON dc.invoice_item_id = ii.id
   AND dc.business_id = p_business_id
   AND dc.incurred_on <= p_through_date
  WHERE i.business_id = p_business_id
    AND i.deleted_at IS NULL
    AND i.status IN ('issued','partially_paid','paid','overdue')
    AND i.issue_date <= p_through_date;

  RETURN md5(COALESCE(v_journal_digest,'') || ':' || COALESCE(v_cost_digest,''));
END;
$financial_digest$;

REVOKE ALL ON FUNCTION public.financial_completeness_evidence_digest(date,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.financial_completeness_evidence_digest(date,uuid)
  TO audit_ledger_rpc_owner;
ALTER FUNCTION public.financial_completeness_evidence_digest(date,uuid)
  OWNER TO audit_ledger_rpc_owner;

CREATE OR REPLACE FUNCTION public.get_financial_completeness_attestation()
RETURNS TABLE(
  attestation_id uuid,
  attested_through date,
  statement text,
  attested_by uuid,
  attested_at timestamptz,
  is_current boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_financial_attestation$
DECLARE
  v_business_id uuid := public.current_business_id();
BEGIN
  IF v_business_id IS NULL OR NOT public.has_business_role(
    v_business_id, ARRAY['owner','admin','accountant','auditor']::text[]
  ) THEN
    RAISE EXCEPTION 'You are not authorized to view financial completeness attestations'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id,a.attested_through,a.statement,a.attested_by,a.attested_at,
    a.evidence_digest = public.financial_completeness_evidence_digest(a.attested_through,v_business_id)
  FROM public.financial_completeness_attestations a
  WHERE a.business_id = v_business_id
  ORDER BY a.attestation_sequence DESC
  LIMIT 1;
END;
$get_financial_attestation$;

CREATE OR REPLACE FUNCTION public.attest_financial_completeness(
  p_attested_through date,
  p_statement text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $attest_financial_completeness$
DECLARE
  v_business_id uuid := public.current_business_id();
  v_existing public.financial_completeness_attestations%ROWTYPE;
  v_last_date date;
  v_digest text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL OR NOT public.has_business_role(
    v_business_id, ARRAY['owner','admin','accountant']::text[]
  ) THEN
    RAISE EXCEPTION 'Only an active business owner, admin or accountant can attest financial completeness'
      USING ERRCODE = '42501';
  END IF;
  IF p_attested_through IS NULL OR p_attested_through > CURRENT_DATE
     OR p_idempotency_key IS NULL
     OR NULLIF(BTRIM(p_statement),'') IS NULL
     OR length(BTRIM(p_statement)) < 30 THEN
    RAISE EXCEPTION 'Provide a valid past or current date, a completeness declaration of at least 30 characters, and an idempotency key';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  SELECT * INTO v_existing
  FROM public.financial_completeness_attestations
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.business_id IS DISTINCT FROM v_business_id
       OR v_existing.attested_through <> p_attested_through
       OR v_existing.statement <> BTRIM(p_statement)
       OR v_existing.attested_by <> auth.uid() THEN
      RAISE EXCEPTION 'This attestation idempotency key was already used with different details or business scope';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT max(attested_through) INTO v_last_date
  FROM public.financial_completeness_attestations
  WHERE business_id = v_business_id;
  IF v_last_date IS NOT NULL AND p_attested_through < v_last_date THEN
    RAISE EXCEPTION 'A new attestation cannot move the reporting date backwards';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_entries je
    LEFT JOIN public.journal_lines jl
      ON jl.journal_entry_id = je.id
     AND jl.business_id = v_business_id
    WHERE je.business_id = v_business_id
      AND je.entry_date <= p_attested_through
    GROUP BY je.id
    HAVING count(jl.id) < 2
       OR COALESCE(sum(jl.debit),0) <= 0
       OR COALESCE(sum(jl.credit),0) <= 0
       OR round(COALESCE(sum(jl.debit),0),2) <> round(COALESCE(sum(jl.credit),0),2)
  ) THEN
    RAISE EXCEPTION 'The ledger contains an unbalanced or incomplete journal through the attestation date';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoices i
    JOIN public.invoice_items ii
      ON ii.invoice_id = i.id
     AND ii.business_id = v_business_id
    LEFT JOIN public.products p
      ON p.id = ii.product_id
     AND p.business_id = v_business_id
    LEFT JOIN public.invoice_item_direct_costs dc
      ON dc.invoice_item_id = ii.id
     AND dc.business_id = v_business_id
     AND dc.incurred_on <= p_attested_through
    WHERE i.business_id = v_business_id
      AND i.deleted_at IS NULL
      AND i.status IN ('issued','partially_paid','paid','overdue')
      AND i.issue_date <= p_attested_through
      AND (
        (ii.product_id IS NOT NULL AND NOT COALESCE(p.is_service,false) AND ii.unit_cost IS NULL)
        OR ((ii.product_id IS NULL OR COALESCE(p.is_service,false)) AND dc.id IS NULL)
      )
  ) THEN
    RAISE EXCEPTION 'Issued invoice lines through the attestation date still have unverified product or direct service costs';
  END IF;

  v_digest := public.financial_completeness_evidence_digest(p_attested_through,v_business_id);

  INSERT INTO public.financial_completeness_attestations(
    attested_through,statement,evidence_digest,idempotency_key,attested_by,business_id
  )
  VALUES(p_attested_through,BTRIM(p_statement),v_digest,p_idempotency_key,auth.uid(),v_business_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$attest_financial_completeness$;

DROP POLICY IF EXISTS financial_completeness_attestations_finance_read
  ON public.financial_completeness_attestations;
CREATE POLICY financial_completeness_attestations_finance_read
  ON public.financial_completeness_attestations
  FOR SELECT TO authenticated
  USING (
    public.has_business_role(
      business_id, ARRAY['owner','admin','accountant','auditor']::text[]
    )
  );

REVOKE ALL ON FUNCTION public.get_customer_account_balances(date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_customer_account_balances(date,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_customer_credit_balances(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_customer_credit_balances(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_financial_completeness_attestation() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_financial_completeness_attestation() TO authenticated;
REVOKE ALL ON FUNCTION public.attest_financial_completeness(date,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attest_financial_completeness(date,text,uuid) TO authenticated;

ALTER FUNCTION public.get_customer_account_balances(date,uuid) OWNER TO audit_ledger_rpc_owner;
ALTER FUNCTION public.get_customer_credit_balances(uuid) OWNER TO audit_ledger_rpc_owner;
ALTER FUNCTION public.get_financial_completeness_attestation() OWNER TO audit_ledger_rpc_owner;
ALTER FUNCTION public.attest_financial_completeness(date,text,uuid) OWNER TO audit_ledger_rpc_owner;

NOTIFY pgrst, 'reload schema';
