-- Number allocation is an internal write operation. Keep the existing RPC
-- because customer creation still calls it, but enforce the same role scope as
-- the underlying create workflows before incrementing any sequence.
CREATE OR REPLACE FUNCTION public.get_next_sequence(seq_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  result text;
  seq record;
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
    IF NOT public.has_any_role(ARRAY['admin', 'accountant', 'cashier']::text[]) THEN
      RAISE EXCEPTION 'You are not authorized to allocate this transaction number'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.has_any_role(ARRAY['admin', 'accountant']::text[]) THEN
    RAISE EXCEPTION 'Only an administrator or accountant can allocate this master-data number'
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
