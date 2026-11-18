CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(3);

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

SELECT * FROM extensions.finish();
ROLLBACK;
