CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(7);

CREATE TABLE public.__anon_grant_table_test (id uuid);
CREATE SEQUENCE public.__anon_grant_sequence_test;
CREATE FUNCTION public.__anon_grant_function_test()
RETURNS integer
LANGUAGE sql
AS $test_function$
  SELECT 1;
$test_function$;

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.__anon_grant_table_test', 'SELECT'),
  'New public tables do not retain anonymous SELECT grants'
);
SELECT extensions.ok(
  has_table_privilege('authenticated', 'public.__anon_grant_table_test', 'SELECT'),
  'New public tables retain authenticated grants'
);
SELECT extensions.ok(
  NOT has_sequence_privilege('anon', 'public.__anon_grant_sequence_test', 'USAGE'),
  'New public sequences do not retain anonymous USAGE grants'
);
SELECT extensions.ok(
  has_sequence_privilege('authenticated', 'public.__anon_grant_sequence_test', 'USAGE'),
  'New public sequences retain authenticated grants'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.__anon_grant_function_test()', 'EXECUTE'),
  'New public functions do not retain anonymous EXECUTE grants'
);
SELECT extensions.ok(
  has_function_privilege('authenticated', 'public.__anon_grant_function_test()', 'EXECUTE'),
  'New public functions retain authenticated grants'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_event_trigger
    WHERE evtname = 'secure_public_schema_object_grants'
      AND evtenabled = 'O'
      AND evttags @> ARRAY['CREATE TABLE', 'CREATE SEQUENCE', 'CREATE FUNCTION']
  ),
  'The public-schema grant hardening event trigger is enabled for future DDL'
);

DROP FUNCTION public.__anon_grant_function_test();
DROP SEQUENCE public.__anon_grant_sequence_test;
DROP TABLE public.__anon_grant_table_test;

SELECT * FROM extensions.finish();
ROLLBACK;
