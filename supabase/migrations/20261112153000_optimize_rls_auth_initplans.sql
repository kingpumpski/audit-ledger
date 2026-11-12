-- Evaluate auth.uid() once per statement rather than once per candidate row.
-- This preserves the existing policy predicates, roles, commands, and access rules.
DO $rls_initplan$
DECLARE
  policy_record record;
  updated_qual text;
  updated_check text;
  statement text;
  changed boolean;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        coalesce(qual, '') ~* 'auth\.uid\s*\(\s*\)'
        OR coalesce(with_check, '') ~* 'auth\.uid\s*\(\s*\)'
      )
  LOOP
    updated_qual := policy_record.qual;
    updated_check := policy_record.with_check;
    changed := false;

    IF updated_qual IS NOT NULL
       AND updated_qual ~* 'auth\.uid\s*\(\s*\)'
       AND updated_qual !~* '\(\s*select\s+auth\.uid\s*\(\s*\)\s*\)' THEN
      updated_qual := regexp_replace(
        updated_qual,
        'auth\.uid\s*\(\s*\)',
        '(select auth.uid())',
        'gi'
      );
      changed := true;
    END IF;

    IF updated_check IS NOT NULL
       AND updated_check ~* 'auth\.uid\s*\(\s*\)'
       AND updated_check !~* '\(\s*select\s+auth\.uid\s*\(\s*\)\s*\)' THEN
      updated_check := regexp_replace(
        updated_check,
        'auth\.uid\s*\(\s*\)',
        '(select auth.uid())',
        'gi'
      );
      changed := true;
    END IF;

    IF changed THEN
      statement := format(
        'ALTER POLICY %I ON %I.%I',
        policy_record.policyname,
        policy_record.schemaname,
        policy_record.tablename
      );

      IF updated_qual IS NOT NULL THEN
        statement := statement || format(' USING (%s)', updated_qual);
      END IF;

      IF updated_check IS NOT NULL THEN
        statement := statement || format(' WITH CHECK (%s)', updated_check);
      END IF;

      EXECUTE statement;
    END IF;
  END LOOP;
END
$rls_initplan$;
