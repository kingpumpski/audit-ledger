CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;

-- Report each uncovered foreign key separately so a future regression names
-- the exact table/constraint instead of returning one opaque aggregate failure.
SELECT extensions.plan((
  SELECT count(*)::integer
  FROM pg_constraint c
  WHERE c.contype = 'f'
    AND c.connamespace = 'public'::regnamespace
));

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = c.conrelid
      AND i.indisvalid
      AND i.indisready
      AND i.indpred IS NULL
      AND (
        SELECT array_agg(k.attnum ORDER BY k.ord)
        FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum, ord)
        WHERE k.ord <= cardinality(c.conkey)
      ) = c.conkey
  ),
  pg_catalog.format(
    'Foreign key %I on %s has a valid index covering its leading columns',
    c.conname,
    c.conrelid::regclass
  )
)
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.connamespace = 'public'::regnamespace
ORDER BY c.conrelid::regclass::text, c.conname;

SELECT * FROM extensions.finish();
ROLLBACK;
