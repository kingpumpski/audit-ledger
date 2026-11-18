BEGIN;
SELECT plan(9);

SELECT ok(
  to_regclass('public.business_invitations') IS NOT NULL,
  'business invitation table exists'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.business_invitations'::regclass),
  'business invitations enforce row-level security'
);

SELECT ok(
  NOT has_table_privilege('authenticated','public.business_invitations','INSERT')
  AND NOT has_table_privilege('authenticated','public.business_invitations','UPDATE')
  AND NOT has_table_privilege('authenticated','public.business_invitations','DELETE'),
  'authenticated clients cannot write invitation records directly'
);

SELECT ok(
  has_table_privilege('authenticated','public.business_invitations','SELECT'),
  'authenticated users can read invitations subject to manager RLS'
);

SELECT ok(
  has_function_privilege('authenticated','public.accept_business_invitation(uuid)','EXECUTE'),
  'authenticated invitees can accept through the guarded RPC'
);

SELECT ok(
  NOT has_function_privilege('anon','public.accept_business_invitation(uuid)','EXECUTE'),
  'anonymous callers cannot accept invitations'
);

SELECT ok(
  has_function_privilege('authenticated','public.revoke_business_invitation(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.revoke_business_invitation(uuid)','EXECUTE'),
  'only authenticated users can request guarded invitation revocation'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public'
      AND indexname='uq_business_invitations_pending_email'
  ),
  'pending invitations are unique per business and email'
);

SELECT ok(
  has_function_privilege('authenticated','public.get_business_members(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_business_members(uuid)','EXECUTE'),
  'only authenticated users can call the manager-guarded member directory RPC'
);

SELECT * FROM finish();
ROLLBACK;
