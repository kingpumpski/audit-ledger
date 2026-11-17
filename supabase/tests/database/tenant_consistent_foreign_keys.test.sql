BEGIN;
SELECT plan(4);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_constraint
   WHERE connamespace='public'::regnamespace
     AND contype='f'
     AND convalidated
     AND conname LIKE 'tenant_fk_%'),
  56,
  'all operational foreign keys have validated tenant-consistent constraints'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_constraint
   WHERE connamespace='public'::regnamespace
     AND contype='f'
     AND convalidated
     AND conname LIKE 'tenant_fk_%'
     AND cardinality(conkey)=2
     AND cardinality(confkey)=2),
  56,
  'each tenant relationship binds both business_id and parent identifier'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace='public'::regnamespace
      AND contype='f'
      AND conname LIKE 'tenant_fk_%'
      AND NOT convalidated
  ),
  'no tenant relationship remains unvalidated'
);

SELECT ok(
  (SELECT count(*)=33
   FROM information_schema.columns
   WHERE table_schema='public'
     AND column_name='business_id'
     AND is_nullable='NO'),
  'all 33 business-owned tables retain mandatory business ownership'
);

SELECT * FROM finish();
ROLLBACK;
