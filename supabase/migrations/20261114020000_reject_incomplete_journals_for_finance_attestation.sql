-- A journal with no posting lines has zero debits and zero credits, but is not a valid balanced entry.
-- Finance completeness sign-off must reject empty or one-sided journal records.
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
  v_existing public.financial_completeness_attestations%ROWTYPE;
  v_last_date date;
  v_digest text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Only an admin or accountant can attest financial completeness';
  END IF;
  IF p_attested_through IS NULL OR p_attested_through > CURRENT_DATE
     OR p_idempotency_key IS NULL
     OR NULLIF(BTRIM(p_statement), '') IS NULL
     OR length(BTRIM(p_statement)) < 30 THEN
    RAISE EXCEPTION 'Provide a valid past or current date, a completeness declaration of at least 30 characters, and an idempotency key';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_existing
  FROM public.financial_completeness_attestations
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.attested_through <> p_attested_through
       OR v_existing.statement <> BTRIM(p_statement)
       OR v_existing.attested_by <> auth.uid() THEN
      RAISE EXCEPTION 'This attestation idempotency key was already used with different details';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT max(attested_through) INTO v_last_date
  FROM public.financial_completeness_attestations;
  IF v_last_date IS NOT NULL AND p_attested_through < v_last_date THEN
    RAISE EXCEPTION 'A new attestation cannot move the reporting date backwards';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_entries je
    LEFT JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.entry_date <= p_attested_through
    GROUP BY je.id
    HAVING count(jl.id) < 2
       OR COALESCE(sum(jl.debit), 0) <= 0
       OR COALESCE(sum(jl.credit), 0) <= 0
       OR round(COALESCE(sum(jl.debit), 0), 2) <> round(COALESCE(sum(jl.credit), 0), 2)
  ) THEN
    RAISE EXCEPTION 'The ledger contains an unbalanced or incomplete journal through the attestation date';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoices i
    JOIN public.invoice_items ii ON ii.invoice_id = i.id
    LEFT JOIN public.products p ON p.id = ii.product_id
    LEFT JOIN public.invoice_item_direct_costs dc
      ON dc.invoice_item_id = ii.id AND dc.incurred_on <= p_attested_through
    WHERE i.deleted_at IS NULL
      AND i.status IN ('issued', 'partially_paid', 'paid', 'overdue')
      AND i.issue_date <= p_attested_through
      AND (
        (ii.product_id IS NOT NULL AND NOT COALESCE(p.is_service, false) AND ii.unit_cost IS NULL)
        OR ((ii.product_id IS NULL OR COALESCE(p.is_service, false)) AND dc.id IS NULL)
      )
  ) THEN
    RAISE EXCEPTION 'Issued invoice lines through the attestation date still have unverified product or direct service costs';
  END IF;

  v_digest := public.financial_completeness_evidence_digest(p_attested_through);

  INSERT INTO public.financial_completeness_attestations (
    attested_through, statement, evidence_digest, idempotency_key, attested_by
  )
  VALUES (
    p_attested_through, BTRIM(p_statement), v_digest, p_idempotency_key, auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$attest_financial_completeness$;

REVOKE ALL ON FUNCTION public.attest_financial_completeness(date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attest_financial_completeness(date, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
