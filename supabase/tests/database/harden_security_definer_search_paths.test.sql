CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(1);

SELECT extensions.ok(
  (
    SELECT count(*) = 12
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.oid::regprocedure::text IN (
        'assign_user_role(uuid,app_role,uuid)',
        'claim_initial_admin()',
        'get_next_sequence(text)',
        'get_user_role(uuid)',
        'has_any_role(text[])',
        'has_any_role(uuid)',
        'has_permission(text)',
        'has_permission(text,uuid)',
        'has_role(app_role)',
        'has_role(uuid,app_role)',
        'is_first_user()',
        'void_receipt_and_reconcile(uuid)'
      )
      AND p.proconfig @> ARRAY['search_path=""']
  ),
  'All twelve authenticated SECURITY DEFINER RPCs use an empty search_path'
);

SELECT * FROM extensions.finish();
ROLLBACK;
