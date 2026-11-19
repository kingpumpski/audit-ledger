-- Number sequences are shared, non-tenant counters. Their RLS policy must
-- authorize the active business membership rather than legacy global user_roles.
-- Allocation remains inside get_next_sequence; authenticated clients do not
-- receive direct table grants beyond the existing sequence table privileges.

DROP POLICY IF EXISTS "Employees can use sequences" ON public.sequences;
DROP POLICY IF EXISTS "Active business members can use sequences" ON public.sequences;

CREATE POLICY "Active business members can use sequences"
ON public.sequences
FOR ALL
TO authenticated
USING (
  public.has_business_role(
    public.current_business_id(),
    ARRAY['owner', 'admin', 'accountant', 'cashier']::text[]
  )
)
WITH CHECK (
  public.has_business_role(
    public.current_business_id(),
    ARRAY['owner', 'admin', 'accountant', 'cashier']::text[]
  )
);

CREATE OR REPLACE FUNCTION public.get_next_sequence(seq_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  result text;
  seq record;
  v_business_id uuid := public.current_business_id();
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'An active business membership is required to allocate a number'
      USING ERRCODE = '42501';
  END IF;

  IF seq_name NOT IN ('invoice', 'receipt', 'payment', 'customer', 'product', 'journal', 'account') THEN
    RAISE EXCEPTION 'Invalid sequence name: %', seq_name
      USING ERRCODE = '22023';
  END IF;

  IF seq_name IN ('invoice', 'receipt', 'payment', 'journal') THEN
    IF NOT public.has_business_role(
      v_business_id,
      ARRAY['owner', 'admin', 'accountant', 'cashier']::text[]
    ) THEN
      RAISE EXCEPTION 'You are not authorized to allocate this transaction number'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.has_business_role(
    v_business_id,
    ARRAY['owner', 'admin', 'accountant']::text[]
  ) THEN
    RAISE EXCEPTION 'Only an owner, administrator or accountant can allocate this master-data number'
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
