-- Make payment-clearing RPCs explicitly tenant-aware.
-- SECURITY DEFINER functions must not infer tenant scope from global roles alone.

CREATE OR REPLACE FUNCTION public.get_payment_clearing_balances()
RETURNS TABLE(account_code text, account_name text, clearing_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_payment_clearing_balances$
DECLARE
  v_business_id uuid := public.current_business_id();
BEGIN
  IF v_business_id IS NULL OR NOT public.has_business_role(
    v_business_id, ARRAY['owner','admin','accountant','auditor']::text[]
  ) THEN
    RAISE EXCEPTION 'You are not authorized to view payment clearing balances'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT coa.code, coa.name,
    ROUND(COALESCE(SUM(jl.debit - jl.credit), 0), 2)::numeric(15,2)
  FROM public.chart_of_accounts coa
  LEFT JOIN public.journal_lines jl
    ON jl.account_id = coa.id
   AND jl.business_id = v_business_id
  LEFT JOIN public.journal_entries je
    ON je.id = jl.journal_entry_id
   AND je.business_id = v_business_id
  WHERE coa.business_id = v_business_id
    AND coa.code IN ('1020','1030','1040')
  GROUP BY coa.code, coa.name
  ORDER BY coa.code;
END;
$get_payment_clearing_balances$;

CREATE OR REPLACE FUNCTION public.get_payment_clearing_settlements()
RETURNS TABLE(
  settlement_id uuid,
  account_code text,
  account_name text,
  gross_amount numeric(15,2),
  fee_amount numeric(15,2),
  net_amount numeric(15,2),
  settled_on date,
  provider_reference text,
  bank_reference text,
  notes text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_payment_clearing_settlements$
DECLARE
  v_business_id uuid := public.current_business_id();
BEGIN
  IF v_business_id IS NULL OR NOT public.has_business_role(
    v_business_id, ARRAY['owner','admin','accountant','auditor']::text[]
  ) THEN
    RAISE EXCEPTION 'You are not authorized to view payment clearing settlement history'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.id, coa.code, coa.name, s.gross_amount, s.fee_amount, s.net_amount,
    s.settled_on, s.provider_reference, s.bank_reference, s.notes, s.created_at
  FROM public.payment_clearing_settlements s
  JOIN public.chart_of_accounts coa
    ON coa.id = s.clearing_account_id
   AND coa.business_id = v_business_id
  WHERE s.business_id = v_business_id
  ORDER BY s.settled_on DESC, s.created_at DESC
  LIMIT 100;
END;
$get_payment_clearing_settlements$;

CREATE OR REPLACE FUNCTION public.settle_payment_clearing_account(
  p_clearing_account_code text,
  p_gross_amount numeric,
  p_fee_amount numeric,
  p_settled_on date,
  p_provider_reference text,
  p_bank_reference text,
  p_idempotency_key uuid,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $settle_payment_clearing$
DECLARE
  v_user uuid := auth.uid();
  v_business_id uuid := public.current_business_id();
  v_account_id uuid;
  v_bank_account uuid;
  v_fee_account uuid;
  v_settlement_id uuid := gen_random_uuid();
  v_journal_id uuid;
  v_entry_number text;
  v_currency text;
  v_available numeric(15,2);
  v_net numeric(15,2);
  v_fingerprint text;
  v_existing public.payment_clearing_settlements%ROWTYPE;
BEGIN
  IF v_user IS NULL OR v_business_id IS NULL OR NOT public.has_business_role(
    v_business_id, ARRAY['owner','admin','accountant']::text[]
  ) THEN
    RAISE EXCEPTION 'Only an active business owner, admin or accountant can settle payment clearing accounts'
      USING ERRCODE = '42501';
  END IF;
  IF p_clearing_account_code NOT IN ('1020','1030','1040') THEN
    RAISE EXCEPTION 'Choose a card, mobile-money or cheque clearing account';
  END IF;
  IF p_gross_amount IS NULL OR p_gross_amount <= 0 OR p_gross_amount <> ROUND(p_gross_amount,2)
     OR p_fee_amount IS NULL OR p_fee_amount < 0 OR p_fee_amount <> ROUND(p_fee_amount,2)
     OR p_fee_amount >= p_gross_amount OR p_settled_on IS NULL OR p_settled_on > CURRENT_DATE
     OR NULLIF(BTRIM(p_provider_reference),'') IS NULL
     OR NULLIF(BTRIM(p_bank_reference),'') IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Enter valid gross amount, fees, settlement date and both settlement references';
  END IF;

  v_fingerprint := md5(concat_ws('|',p_clearing_account_code,p_gross_amount,p_fee_amount,p_settled_on,
    BTRIM(p_provider_reference),BTRIM(p_bank_reference),COALESCE(BTRIM(p_notes),'')));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  SELECT * INTO v_existing
  FROM public.payment_clearing_settlements
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.business_id IS DISTINCT FROM v_business_id
       OR v_existing.request_fingerprint <> v_fingerprint
       OR v_existing.created_by <> v_user THEN
      RAISE EXCEPTION 'This settlement idempotency key was already used with different details or business scope';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT id INTO v_account_id
  FROM public.chart_of_accounts
  WHERE business_id = v_business_id
    AND code = p_clearing_account_code
    AND account_type = 'asset' AND is_active
  FOR UPDATE;
  SELECT id INTO v_bank_account
  FROM public.chart_of_accounts
  WHERE business_id = v_business_id AND code = '1010'
    AND account_type = 'asset' AND is_active;
  SELECT id INTO v_fee_account
  FROM public.chart_of_accounts
  WHERE business_id = v_business_id AND code = '6400'
    AND account_type = 'expense' AND is_active;
  IF v_account_id IS NULL OR v_bank_account IS NULL OR v_fee_account IS NULL THEN
    RAISE EXCEPTION 'Clearing, bank or merchant-fee account is not configured for the active business';
  END IF;

  SELECT ROUND(COALESCE(SUM(jl.debit-jl.credit),0),2) INTO v_available
  FROM public.journal_lines jl
  JOIN public.journal_entries je
    ON je.id = jl.journal_entry_id
   AND je.business_id = v_business_id
  WHERE jl.business_id = v_business_id
    AND jl.account_id = v_account_id
    AND je.entry_date <= p_settled_on;
  IF p_gross_amount > v_available THEN
    RAISE EXCEPTION 'Settlement exceeds the clearing balance available on % (available %)',p_settled_on,v_available;
  END IF;

  v_net := ROUND(p_gross_amount-p_fee_amount,2);
  v_entry_number := public.get_next_sequence('journal');
  SELECT COALESCE(currency_code,'USD') INTO v_currency
  FROM public.company_settings
  WHERE business_id = v_business_id
  ORDER BY created_at DESC
  LIMIT 1;
  v_currency := COALESCE(v_currency,'USD');

  INSERT INTO public.journal_entries(
    entry_number,entry_date,description,source_type,source_id,currency,created_by,business_id
  )
  VALUES(
    v_entry_number,p_settled_on,'Settlement of clearing account '||p_clearing_account_code||
    ' - '||BTRIM(p_provider_reference),'payment_clearing_settlement',v_settlement_id,v_currency,v_user,v_business_id
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines(
    journal_entry_id,line_number,account_id,description,debit,credit,business_id
  )
  VALUES(v_journal_id,1,v_bank_account,'Net settlement received - '||BTRIM(p_bank_reference),v_net,0,v_business_id);
  IF p_fee_amount > 0 THEN
    INSERT INTO public.journal_lines(
      journal_entry_id,line_number,account_id,description,debit,credit,business_id
    )
    VALUES(v_journal_id,2,v_fee_account,'Payment processor / settlement fees',p_fee_amount,0,v_business_id);
  END IF;
  INSERT INTO public.journal_lines(
    journal_entry_id,line_number,account_id,description,debit,credit,business_id
  )
  VALUES(
    v_journal_id,CASE WHEN p_fee_amount > 0 THEN 3 ELSE 2 END,v_account_id,
    'Clearing balance settled - '||BTRIM(p_provider_reference),0,p_gross_amount,v_business_id
  );

  INSERT INTO public.payment_clearing_settlements(
    id,clearing_account_id,gross_amount,fee_amount,settled_on,provider_reference,bank_reference,
    notes,idempotency_key,request_fingerprint,journal_entry_id,created_by,business_id
  )
  VALUES(
    v_settlement_id,v_account_id,p_gross_amount,p_fee_amount,p_settled_on,
    BTRIM(p_provider_reference),BTRIM(p_bank_reference),NULLIF(BTRIM(p_notes),''),
    p_idempotency_key,v_fingerprint,v_journal_id,v_user,v_business_id
  );

  RETURN v_settlement_id;
END;
$settle_payment_clearing$;

REVOKE ALL ON FUNCTION public.get_payment_clearing_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_clearing_balances() TO authenticated;
REVOKE ALL ON FUNCTION public.get_payment_clearing_settlements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_clearing_settlements() TO authenticated;
REVOKE ALL ON FUNCTION public.settle_payment_clearing_account(text,numeric,numeric,date,text,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_payment_clearing_account(text,numeric,numeric,date,text,text,uuid,text) TO authenticated;

DROP POLICY IF EXISTS payment_clearing_settlements_finance_read
  ON public.payment_clearing_settlements;
CREATE POLICY payment_clearing_settlements_finance_read
  ON public.payment_clearing_settlements
  FOR SELECT TO authenticated
  USING (
    public.has_business_role(
      business_id, ARRAY['owner','admin','accountant','auditor']::text[]
    )
  );

NOTIFY pgrst, 'reload schema';
