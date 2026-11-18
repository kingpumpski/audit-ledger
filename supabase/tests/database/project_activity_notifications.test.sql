CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(7);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('e2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'activity-owner-a@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('e2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'activity-member-a@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('e2000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'activity-member-b@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.businesses (
  id, name, business_type, country, base_currency, timezone, status
) VALUES
  ('e2000000-0000-4000-8000-000000000010', 'Activity Workspace A', 'small_business', 'Ghana', 'GHS', 'Africa/Accra', 'active'),
  ('e2000000-0000-4000-8000-000000000020', 'Activity Workspace B', 'small_business', 'Ghana', 'GHS', 'Africa/Accra', 'active');

INSERT INTO public.business_members (business_id, user_id, role, status, joined_at)
VALUES
  ('e2000000-0000-4000-8000-000000000010', 'e2000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('e2000000-0000-4000-8000-000000000010', 'e2000000-0000-4000-8000-000000000002', 'accountant', 'active', now()),
  ('e2000000-0000-4000-8000-000000000020', 'e2000000-0000-4000-8000-000000000003', 'owner', 'active', now());

INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, business_id)
VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'create', 'invoices', 'e2000000-0000-4000-8000-000000000099',
  'e2000000-0000-4000-8000-000000000010'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE business_id = 'e2000000-0000-4000-8000-000000000010'),
  2,
  'Business activity creates one notification for each active member of that business'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE user_id = 'e2000000-0000-4000-8000-000000000003'),
  0,
  'Business activity is not disclosed to members of another business'
);

INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id)
VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'update', 'user_roles', 'e2000000-0000-4000-8000-000000000002'
);

SELECT extensions.is(
  (SELECT count(DISTINCT user_id)::integer FROM public.notifications
   WHERE business_id IS NULL AND type = 'project_activity'),
  3,
  'Context-free project activity creates generic notifications for all active project members'
);

INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id)
VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'update', 'auth.password', 'e2000000-0000-4000-8000-000000000001'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE business_id IS NULL AND type = 'project_activity'),
  3,
  'sensitive authentication activity does not broadcast to other project members'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'is_read'
      AND is_nullable <> 'NO'
  ),
  'notification read state is non-null and safe for unread counting'
);

SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT extensions.lives_ok(
  $global_audit_rejection$
  DO $reject_global_audit$
  BEGIN
    BEGIN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id)
      VALUES (auth.uid(), 'create', 'user_roles', 'e2000000-0000-4000-8000-000000000099');
      RAISE EXCEPTION 'client unexpectedly inserted a context-free audit event';
    EXCEPTION
      WHEN insufficient_privilege THEN
        NULL;
    END;
  END;
  $reject_global_audit$;
  $global_audit_rejection$,
  'authenticated clients cannot spoof context-free project activity'
);

RESET ROLE;

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.tables t
    JOIN information_schema.columns id_col
      ON id_col.table_schema = t.table_schema
      AND id_col.table_name = t.table_name
      AND id_col.column_name = 'id'
    JOIN information_schema.columns business_col
      ON business_col.table_schema = t.table_schema
      AND business_col.table_name = t.table_name
      AND business_col.column_name = 'business_id'
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND t.table_name NOT IN ('audit_logs', 'notifications', 'sequences',
                               'business_members', 'password_history',
                               'password_reset_tokens', 'password_policy')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger tr
        WHERE tr.tgrelid = pg_catalog.format('public.%I', t.table_name)::regclass
          AND tr.tgfoid = 'public.audit_trigger_func()'::regprocedure
          AND NOT tr.tgisinternal
      )
  ),
  'Every business-owned operational table is covered by the audit trigger'
);

SELECT * FROM extensions.finish();
ROLLBACK;
