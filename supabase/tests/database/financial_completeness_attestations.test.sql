CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(13);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'finance-attest-accountant@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('f0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'finance-attest-auditor@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('f0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'finance-attest-cashier@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.user_roles (user_id, role) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'accountant'),
  ('f0000000-0000-4000-8000-000000000002', 'auditor'),
  ('f0000000-0000-4000-8000-000000000003', 'cashier');

SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT extensions.lives_ok(
  $$ SELECT public.attest_financial_completeness(
    CURRENT_DATE,
    'I confirm that all expenses and direct costs through this date have been entered and reconciled to supporting evidence.',
    'f0000000-0000-4000-8000-000000000101'
  ) $$,
  'Accountant can attest a balanced ledger when no issued invoice cost evidence is missing'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.financial_completeness_attestations),
  1,
  'Attestation is stored as an immutable audit record'
);

SELECT extensions.is(
  (SELECT is_current FROM public.get_financial_completeness_attestation()),
  true,
  'New attestation matches the current journal and cost evidence digest'
);

SELECT extensions.lives_ok(
  $$ SELECT public.attest_financial_completeness(
    CURRENT_DATE,
    'I confirm that all expenses and direct costs through this date have been entered and reconciled to supporting evidence.',
    'f0000000-0000-4000-8000-000000000101'
  ) $$,
  'Retrying the same attestation idempotency key returns the original record'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.financial_completeness_attestations),
  1,
  'Idempotent attestation retry does not duplicate the audit record'
);

SELECT extensions.throws_ok(
  $$ UPDATE public.financial_completeness_attestations
     SET statement = 'Changed after attestation'
     WHERE idempotency_key = 'f0000000-0000-4000-8000-000000000101' $$,
  'P0001',
  'Financial completeness attestations are immutable audit records',
  'Attestation evidence cannot be edited after sign-off'
);

INSERT INTO public.journal_entries (
  entry_number, entry_date, description, source_type, source_id, currency, created_by
) VALUES (
  public.get_next_sequence('journal'), CURRENT_DATE,
  'Backdated journal added after finance attestation', 'payment',
  'f0000000-0000-4000-8000-000000000201', 'USD',
  'f0000000-0000-4000-8000-000000000001'
);

INSERT INTO public.journal_lines (
  journal_entry_id, line_number, account_id, description, debit, credit
)
SELECT je.id, 1, coa.id, 'Cash movement', 25.00, 0
FROM public.journal_entries je
JOIN public.chart_of_accounts coa ON coa.code = '1000'
WHERE je.source_id = 'f0000000-0000-4000-8000-000000000201'
  AND je.source_type = 'payment';

INSERT INTO public.journal_lines (
  journal_entry_id, line_number, account_id, description, debit, credit
)
SELECT je.id, 2, coa.id, 'Revenue movement', 0, 25.00
FROM public.journal_entries je
JOIN public.chart_of_accounts coa ON coa.code = '4000'
WHERE je.source_id = 'f0000000-0000-4000-8000-000000000201'
  AND je.source_type = 'payment';

SELECT extensions.is(
  (SELECT is_current FROM public.get_financial_completeness_attestation()),
  false,
  'A later backdated journal invalidates the previous completeness attestation'
);

SELECT extensions.lives_ok(
  $$ SELECT public.attest_financial_completeness(
    CURRENT_DATE,
    'I confirm that all expenses and direct costs through this date have been entered and reconciled to supporting evidence.',
    'f0000000-0000-4000-8000-000000000102'
  ) $$,
  'Accountant can re-attest after reviewing the updated ledger'
);

SELECT extensions.is(
  (SELECT is_current FROM public.get_financial_completeness_attestation()),
  true,
  'The latest attestation is current after the updated ledger is reviewed'
);

SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000002', true);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.get_financial_completeness_attestation()),
  1,
  'Auditor can review the latest attestation'
);

SELECT extensions.throws_ok(
  $$ SELECT public.attest_financial_completeness(
    CURRENT_DATE,
    'I confirm that all expenses and direct costs through this date have been entered and reconciled to supporting evidence.',
    'f0000000-0000-4000-8000-000000000103'
  ) $$,
  'P0001',
  'Only an admin or accountant can attest financial completeness',
  'Auditor cannot create a finance completeness attestation'
);

SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000003', true);

SELECT extensions.throws_ok(
  $$ SELECT public.get_financial_completeness_attestation() $$,
  'P0001',
  'You are not authorized to view financial completeness attestations',
  'Cashier cannot view finance attestation records'
);

SELECT extensions.finish();
ROLLBACK;
