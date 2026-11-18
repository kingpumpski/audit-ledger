BEGIN;
SELECT plan(16);

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


INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'invitation-owner@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('c1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'invitation-member@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.businesses (
  id, name, business_type, country, base_currency, timezone, status
) VALUES (
  'c1000000-0000-4000-8000-000000000010',
  'Invitation Test Workspace', 'small_business', 'Ghana', 'GHS', 'Africa/Accra', 'active'
);

INSERT INTO public.business_members (business_id, user_id, role, status, joined_at)
VALUES (
  'c1000000-0000-4000-8000-000000000010',
  'c1000000-0000-4000-8000-000000000001',
  'owner', 'active', now()
);

INSERT INTO public.business_invitations (
  id, business_id, email, role, invited_by, auth_user_id, expires_at
) VALUES
  ('c1000000-0000-4000-8000-000000000020',
   'c1000000-0000-4000-8000-000000000010',
   'invitation-member@example.invalid', 'accountant',
   'c1000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000002',
   now() + interval '1 hour'),
  ('c1000000-0000-4000-8000-000000000021',
   'c1000000-0000-4000-8000-000000000010',
   'different-email@example.invalid', 'cashier',
   'c1000000-0000-4000-8000-000000000001',
   NULL,
   now() + interval '1 hour'),
  ('c1000000-0000-4000-8000-000000000022',
   'c1000000-0000-4000-8000-000000000010',
   'expired-member@example.invalid', 'auditor',
   'c1000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000002',
   now() - interval '1 minute');

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'c1000000-0000-4000-8000-000000000002',
    'email', 'invitation-member@example.invalid',
    'role', 'authenticated',
    'app_metadata', '{}'::jsonb
  )::text,
  true
);
SET LOCAL ROLE authenticated;

SELECT extensions.is(
  public.accept_business_invitation('c1000000-0000-4000-8000-000000000020'),
  'c1000000-0000-4000-8000-000000000010'::uuid,
  'a confirmed invitee activates membership in the invited business'
);

SELECT extensions.is(
  (SELECT role FROM public.business_members
   WHERE business_id='c1000000-0000-4000-8000-000000000010'
     AND user_id='c1000000-0000-4000-8000-000000000002'),
  'accountant',
  'acceptance applies only the role approved by the business owner'
);

RESET ROLE;

SELECT extensions.is(
  (SELECT status FROM public.business_invitations
   WHERE id='c1000000-0000-4000-8000-000000000020'),
  'accepted',
  'successful acceptance consumes the pending invitation'
);

SET LOCAL ROLE authenticated;

SELECT extensions.is(
  public.accept_business_invitation('c1000000-0000-4000-8000-000000000020'),
  'c1000000-0000-4000-8000-000000000010'::uuid,
  'retrying an accepted invitation for the same user is idempotent'
);

SELECT extensions.lives_ok(
  $wrong_email$
  DO $reject_wrong_email$
  BEGIN
    BEGIN
      PERFORM public.accept_business_invitation('c1000000-0000-4000-8000-000000000021');
      RAISE EXCEPTION 'wrong email unexpectedly accepted invitation';
    EXCEPTION
      WHEN insufficient_privilege THEN
        NULL;
    END;
  END;
  $reject_wrong_email$;
  $wrong_email$,
  'an authenticated user cannot accept an invitation addressed to another email'
);

SELECT extensions.is(
  public.accept_business_invitation('c1000000-0000-4000-8000-000000000022'),
  NULL::uuid,
  'an expired invitation does not activate membership'
);

RESET ROLE;

SELECT extensions.is(
  (SELECT status FROM public.business_invitations
   WHERE id='c1000000-0000-4000-8000-000000000022'),
  'expired',
  'an expired invitation is marked expired without rolling back the status change'
);

SELECT * FROM finish();
ROLLBACK;
