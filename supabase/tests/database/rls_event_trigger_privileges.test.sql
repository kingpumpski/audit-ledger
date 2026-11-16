CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(5);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_event_trigger et
    WHERE et.evtfoid = 'public.rls_auto_enable()'::regprocedure
  ),
  'RLS auto-enable remains registered as a PostgreSQL event trigger'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE'),
  'Anonymous clients cannot execute the RLS event-trigger function'
);

SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE'),
  'Authenticated clients cannot execute the RLS event-trigger function'
);

SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'public.rls_auto_enable()', 'EXECUTE'),
  'Service-role API clients cannot execute the RLS event-trigger function'
);

SELECT extensions.ok(
  has_function_privilege('postgres', 'public.rls_auto_enable()', 'EXECUTE'),
  'The owning database administrator retains function execution privilege'
);

SELECT * FROM extensions.finish();
ROLLBACK;
