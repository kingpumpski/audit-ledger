-- Finance sign-off for a complete, reconciled profit-and-loss snapshot.
-- The attestation is append-only and bound to a digest of posted journals and
-- issued-invoice cost evidence through the stated date. Backdated ledger or
-- cost-evidence changes make the latest attestation stale automatically.
CREATE TABLE public.financial_completeness_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attested_through date NOT NULL,
  statement text NOT NULL CHECK (length(btrim(statement)) BETWEEN 30 AND 2000),
  evidence_digest text NOT NULL CHECK (length(evidence_digest) = 32),
  idempotency_key uuid NOT NULL UNIQUE,
  attested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  attestation_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  attested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX financial_completeness_attestations_latest_idx
  ON public.financial_completeness_attestations(attestation_sequence DESC);

ALTER TABLE public.financial_completeness_attestations ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_completeness_attestations_finance_read
  ON public.financial_completeness_attestations
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'auditor']));

REVOKE ALL ON TABLE public.financial_completeness_attestations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.financial_completeness_attestations TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_financial_completeness_attestation_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $attestation_immutable$
BEGIN
  RAISE EXCEPTION 'Financial completeness attestations are immutable audit records';
END;
$attestation_immutable$;

CREATE TRIGGER financial_completeness_attestations_immutable
BEFORE UPDATE OR DELETE ON public.financial_completeness_attestations
FOR EACH ROW
EXECUTE FUNCTION public.guard_financial_completeness_attestation_mutations();

REVOKE ALL ON FUNCTION public.guard_financial_completeness_attestation_mutations() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.financial_completeness_evidence_digest(p_through_date date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $financial_digest$
DECLARE
  v_journal_digest text;
  v_cost_digest text;
BEGIN
  IF p_through_date IS NULL THEN
    RAISE EXCEPTION 'An attestation date is required';
  END IF;

  SELECT md5(COALESCE(string_agg(
    concat_ws('|',
      je.id::text,
      je.entry_date::text,
      je.source_type,
      COALESCE(je.source_id::text, ''),
      COALESCE(je.currency, ''),
      COALESCE(lines.line_digest, '')
    ),
    E'\\n' ORDER BY je.id::text
  ), ''))
  INTO v_journal_digest
  FROM public.journal_entries je
  LEFT JOIN LATERAL (
    SELECT string_agg(
      concat_ws(':',
        jl.line_number::text,
        jl.account_id::text,
        round(jl.debit, 2)::text,
        round(jl.credit, 2)::text
      ),
      ',' ORDER BY jl.line_number
    ) AS line_digest
    FROM public.journal_lines jl
    WHERE jl.journal_entry_id = je.id
  ) lines ON true
  WHERE je.entry_date <= p_through_date;

  SELECT md5(COALESCE(string_agg(
    concat_ws('|',
      i.id::text,
      i.issue_date::text,
      ii.id::text,
      COALESCE(ii.product_id::text, ''),
      ii.quantity::text,
      COALESCE(ii.unit_cost::text, ''),
      COALESCE(p.is_service::text, 'false'),
      COALESCE(dc.id::text, ''),
      COALESCE(dc.amount::text, ''),
      COALESCE(dc.source_reference, ''),
      COALESCE(dc.incurred_on::text, ''),
      COALESCE(dc.payment_method::text, ''),
      COALESCE(dc.journal_entry_id::text, '')
    ),
    E'\\n' ORDER BY ii.id::text
  ), ''))
  INTO v_cost_digest
  FROM public.invoices i
  JOIN public.invoice_items ii ON ii.invoice_id = i.id
  LEFT JOIN public.products p ON p.id = ii.product_id
  LEFT JOIN public.invoice_item_direct_costs dc
    ON dc.invoice_item_id = ii.id AND dc.incurred_on <= p_through_date
  WHERE i.deleted_at IS NULL
    AND i.status IN ('issued', 'partially_paid', 'paid', 'overdue')
    AND i.issue_date <= p_through_date;

  RETURN md5(COALESCE(v_journal_digest, '') || ':' || COALESCE(v_cost_digest, ''));
END;
$financial_digest$;

REVOKE ALL ON FUNCTION public.financial_completeness_evidence_digest(date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_financial_completeness_attestation()
RETURNS TABLE (
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
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['admin', 'accountant', 'auditor']) THEN
    RAISE EXCEPTION 'You are not authorized to view financial completeness attestations';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.attested_through,
    a.statement,
    a.attested_by,
    a.attested_at,
    a.evidence_digest = public.financial_completeness_evidence_digest(a.attested_through)
  FROM public.financial_completeness_attestations a
  ORDER BY a.attestation_sequence DESC
  LIMIT 1;
END;
$get_financial_attestation$;

REVOKE ALL ON FUNCTION public.get_financial_completeness_attestation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_completeness_attestation() TO authenticated;

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
    HAVING round(COALESCE(sum(jl.debit), 0), 2) <> round(COALESCE(sum(jl.credit), 0), 2)
  ) THEN
    RAISE EXCEPTION 'The ledger contains an unbalanced journal through the attestation date';
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
