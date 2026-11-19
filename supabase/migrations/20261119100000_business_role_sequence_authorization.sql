-- Extend sequence allocation to business-scoped memberships while preserving
-- the legacy workspace role path used by existing installations and tests.
-- Sequences remain shared monotonic counters; the active business only governs
-- authorization, not the counter key.

-- Sequence counters are intentionally global and shared across workspaces.
-- They are not tenant-owned records: the generic restrictive tenant policy
-- would hide the legacy counter row from a member of a newer workspace.
-- Keep table access internal to the constrained SECURITY DEFINER RPC owner;
-- callers must pass the role checks below before the counter is incremented.
DROP POLICY IF EXISTS "Active business members can use shared sequences"
  ON public.sequences;
DROP POLICY IF EXISTS tenant_business_scope ON public.sequences;

REVOKE ALL ON TABLE public.sequences
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE ON TABLE public.sequences
  TO audit_ledger_rpc_owner;

CREATE OR REPLACE FUNCTION public.get_next_sequence(seq_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  result text;
  seq record;
  v_business_id uuid := public.current_business_id();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to allocate a number'
      USING ERRCODE = '42501';
  END IF;

  IF seq_name NOT IN ('invoice', 'receipt', 'payment', 'customer', 'product', 'journal', 'account') THEN
    RAISE EXCEPTION 'Invalid sequence name: %', seq_name
      USING ERRCODE = '22023';
  END IF;

  IF seq_name IN ('invoice', 'receipt', 'payment', 'journal') THEN
    IF NOT (
      (v_business_id IS NOT NULL AND public.has_business_role(
        v_business_id, ARRAY['owner', 'admin', 'accountant', 'cashier']::text[]
      ))
      OR
      (
        v_business_id = public.legacy_business_id()
        AND NOT EXISTS (
          SELECT 1 FROM public.business_members bm
          WHERE bm.user_id = auth.uid()
        )
        AND public.has_any_role(ARRAY['admin', 'accountant', 'cashier']::text[])
      )
    ) THEN
      RAISE EXCEPTION 'You are not authorized to allocate this transaction number'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT (
    (v_business_id IS NOT NULL AND public.has_business_role(
      v_business_id, ARRAY['owner', 'admin', 'accountant']::text[]
    ))
    OR
    (
      v_business_id = public.legacy_business_id()
      AND NOT EXISTS (
        SELECT 1 FROM public.business_members bm
        WHERE bm.user_id = auth.uid()
      )
      AND public.has_any_role(ARRAY['admin', 'accountant']::text[])
    )
  ) THEN
    RAISE EXCEPTION 'Only an administrator, owner or accountant can allocate this master-data number'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.sequences
  SET current_value = current_value + 1,
      updated_at = now()
  WHERE name = seq_name
  RETURNING prefix, current_value, padding INTO seq;

  IF seq.prefix IS NULL THEN
    RAISE EXCEPTION 'Sequence not found: %', seq_name;
  END IF;

  result := seq.prefix || lpad(seq.current_value::text, seq.padding, '0');
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_next_sequence(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_sequence(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
