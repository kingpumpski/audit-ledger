CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(1);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.connamespace = 'public'::regnamespace
      AND NOT EXISTS (
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
      )
  ),
  'Every public-schema foreign key has a valid index covering its leading columns'
);

SELECT * FROM extensions.finish();
ROLLBACK;
