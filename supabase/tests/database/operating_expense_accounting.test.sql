CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(40);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'expense-accountant@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('e0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'expense-cashier@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.user_roles (user_id, role) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'accountant'),
  ('e0000000-0000-4000-8000-000000000002', 'cashier');

SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT extensions.lives_ok(
  $$ SELECT public.record_operating_expense(
    'Office internet service', 'Example Telecom', 'OPEX-TEST-001',
    (SELECT id FROM public.chart_of_accounts
     WHERE account_type = 'expense' AND is_active AND code NOT IN ('5000', '6500') ORDER BY code LIMIT 1),
    CURRENT_DATE, CURRENT_DATE + 14, 100.00, 40.00,
    'cash', 'CASH-TEST-001', 'Monthly internet subscription',
    'e0000000-0000-4000-8000-000000000101'
  ) $$,
  'Accountant can record an evidenced operating expense with a partial payment'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_operating_expense(
    'Office internet service', 'Example Telecom', 'OPEX-TEST-001',
    (SELECT id FROM public.chart_of_accounts
     WHERE account_type = 'expense' AND is_active AND code NOT IN ('5000', '6500') ORDER BY code LIMIT 1),
    CURRENT_DATE, CURRENT_DATE + 14, 100.00, 40.00,
    'cash', 'CASH-TEST-001', 'Monthly internet subscription',
    'e0000000-0000-4000-8000-000000000101'
  ) $$,
  'Retrying expense creation with the same idempotency key returns the original expense'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001'),
  1,
  'Expense record is created once'
);

SELECT extensions.is(
  (SELECT amount_paid FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001'),
  40.00::numeric,
  'Initial payment updates the paid balance'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   WHERE je.source_type = 'operating_expense'
     AND je.source_id = (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001')),
  100.00::numeric,
  'Expense is recognized at its full incurred amount'
);

SELECT extensions.is(
  (SELECT round(sum(jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'operating_expense'
     AND je.source_id = (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001')
     AND coa.code = '2000'),
  100.00::numeric,
  'Full supplier liability is recognized when expense is incurred'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.operating_expense_payments p
   JOIN public.operating_expenses e ON e.id = p.operating_expense_id
   WHERE e.reference_number = 'OPEX-TEST-001'),
  1,
  'Initial settlement is retained as an individual payment record'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit - jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   WHERE je.source_type IN ('operating_expense', 'operating_expense_payment')
     AND (je.source_id = (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001')
       OR je.source_id IN (SELECT p.id FROM public.operating_expense_payments p
                           JOIN public.operating_expenses e ON e.id = p.operating_expense_id
                           WHERE e.reference_number = 'OPEX-TEST-001'))),
  0::numeric,
  'Expense recognition and initial payment journals are balanced'
);

SELECT extensions.lives_ok(
  $$ SELECT public.pay_operating_expense(
    (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001'),
    60.00, CURRENT_DATE, 'bank_transfer', 'BANK-TEST-001',
    'e0000000-0000-4000-8000-000000000102'
  ) $$,
  'Accountant can settle the remaining supplier balance'
);

SELECT extensions.is(
  (SELECT amount_paid FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001'),
  100.00::numeric,
  'Settlement updates the expense to fully paid'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.operating_expense_payments p
   JOIN public.operating_expenses e ON e.id = p.operating_expense_id
   WHERE e.reference_number = 'OPEX-TEST-001'),
  2,
  'Partial and final settlements are separately traceable'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'operating_expense_payment'
     AND je.source_id = (SELECT id FROM public.operating_expense_payments
                         WHERE reference_number = 'BANK-TEST-001')
     AND coa.code = '2000'),
  60.00::numeric,
  'Settlement debits Accounts Payable'
);

SELECT extensions.is(
  (SELECT round(sum(jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'operating_expense_payment'
     AND je.source_id = (SELECT id FROM public.operating_expense_payments
                         WHERE reference_number = 'BANK-TEST-001')
     AND coa.code = '1010'),
  60.00::numeric,
  'Bank settlement credits the bank account'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit - jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   WHERE je.source_type IN ('operating_expense', 'operating_expense_payment')
     AND (je.source_id = (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001')
       OR je.source_id IN (SELECT p.id FROM public.operating_expense_payments p
                           JOIN public.operating_expenses e ON e.id = p.operating_expense_id
                           WHERE e.reference_number = 'OPEX-TEST-001'))),
  0::numeric,
  'All expense and settlement journals remain balanced'
);

SELECT extensions.lives_ok(
  $$ SELECT public.pay_operating_expense(
    (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001'),
    60.00, CURRENT_DATE, 'bank_transfer', 'BANK-TEST-001',
    'e0000000-0000-4000-8000-000000000102'
  ) $$,
  'Retrying a settlement with the same idempotency key is accepted'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.operating_expense_payments p
   JOIN public.operating_expenses e ON e.id = p.operating_expense_id
   WHERE e.reference_number = 'OPEX-TEST-001'),
  2,
  'Idempotent settlement retry does not duplicate the payment'
);

SELECT extensions.throws_ok(
  $$ SELECT public.pay_operating_expense(
    (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001'),
    0.01, CURRENT_DATE, 'cash', 'OVERPAY-TEST-001',
    'e0000000-0000-4000-8000-000000000103'
  ) $$,
  'P0001',
  'Payment exceeds the outstanding expense balance',
  'Settlement cannot exceed the supplier balance'
);

SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);

SELECT extensions.throws_ok(
  $$ SELECT public.record_operating_expense(
    'Unauthorized expense', 'Test vendor', 'OPEX-UNAUTH-001',
    (SELECT id FROM public.chart_of_accounts
     WHERE account_type = 'expense' AND is_active AND code NOT IN ('5000', '6500') ORDER BY code LIMIT 1),
    CURRENT_DATE, NULL, 50.00, 0, 'cash', NULL, NULL,
    'e0000000-0000-4000-8000-000000000104'
  ) $$,
  'P0001',
  'Only an admin or accountant can record operating expenses',
  'Cashier cannot record operating expenses'
);

SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);

SELECT extensions.throws_ok(
  $$ UPDATE public.operating_expenses
     SET description = 'Changed after posting'
     WHERE reference_number = 'OPEX-TEST-001' $$,
  'P0001',
  'Posted operating expenses and payments are immutable; use a controlled reversal workflow',
  'Posted expense cannot be directly edited'
);

SELECT extensions.throws_ok(
  $$ DELETE FROM public.operating_expense_payments
     WHERE reference_number = 'BANK-TEST-001' $$,
  'P0001',
  'Posted operating expenses and payments are immutable; use a controlled reversal workflow',
  'Posted settlement cannot be directly deleted'
);


SELECT extensions.lives_ok(
  $$ SELECT public.record_operating_expense(
    'Cancelled office service', 'Example Telecom', 'OPEX-REVERSAL-001',
    (SELECT id FROM public.chart_of_accounts
     WHERE account_type = 'expense' AND is_active AND code NOT IN ('5000', '6500') ORDER BY code LIMIT 1),
    CURRENT_DATE, CURRENT_DATE + 7, 75.00, 0,
    NULL, NULL, 'Service cancelled before payment',
    'e0000000-0000-4000-8000-000000000105'
  ) $$,
  'An unpaid expense can be recorded before reversal'
);

SELECT extensions.lives_ok(
  $$ SELECT public.reverse_unpaid_operating_expense(
    (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-REVERSAL-001'),
    'Supplier cancelled the service',
    'CANCEL-APPROVAL-001',
    'e0000000-0000-4000-8000-000000000106'
  ) $$,
  'Accountant can reverse a fully unpaid expense with a reason and evidence reference'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'operating_expense_reversal'
     AND je.source_id = (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-REVERSAL-001')
     AND coa.code = '2000'),
  75.00::numeric,
  'Expense reversal debits Accounts Payable'
);

SELECT extensions.is(
  (SELECT round(sum(jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'operating_expense_reversal'
     AND je.source_id = (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-REVERSAL-001')
     AND coa.id = (SELECT expense_account_id FROM public.operating_expenses WHERE reference_number = 'OPEX-REVERSAL-001')),
  75.00::numeric,
  'Expense reversal credits the original expense account'
);

SELECT extensions.lives_ok(
  $$ SELECT public.reverse_unpaid_operating_expense(
    (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-REVERSAL-001'),
    'Supplier cancelled the service',
    'CANCEL-APPROVAL-001',
    'e0000000-0000-4000-8000-000000000106'
  ) $$,
  'Retrying the same reversal request is idempotent'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.operating_expense_reversals r
   JOIN public.operating_expenses e ON e.id = r.operating_expense_id
   WHERE e.reference_number = 'OPEX-REVERSAL-001'),
  1,
  'Expense reversal is recorded only once'
);

SELECT extensions.lives_ok(
  $ SELECT public.reverse_unpaid_operating_expense(
    (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001'),
    'Supplier contract cancelled after payment',
    'CANCEL-APPROVAL-PAID-001',
    'e0000000-0000-4000-8000-000000000107'
  ) $,
  'A partially or fully paid expense can be reversed without erasing its payment history'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'operating_expense_reversal'
     AND je.source_id = (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001')
     AND coa.code = '2000'),
  100.00::numeric,
  'Paid expense reversal recognizes the full supplier credit in Accounts Payable'
);

SELECT extensions.lives_ok(
  $ SELECT public.record_operating_expense_refund(
    (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001'),
    25.00, CURRENT_DATE, 'cash', 'SUPPLIER-REFUND-001',
    'e0000000-0000-4000-8000-000000000108'
  ) $,
  'Accountant can record an evidenced partial supplier refund after expense reversal'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.operating_expense_refunds r
   JOIN public.operating_expenses e ON e.id = r.operating_expense_id
   WHERE e.reference_number = 'OPEX-TEST-001'),
  1,
  'Supplier refund is retained as a separate immutable record'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'operating_expense_refund'
     AND je.source_id = (SELECT id FROM public.operating_expense_refunds WHERE reference_number = 'SUPPLIER-REFUND-001')
     AND coa.code = '1000'),
  25.00::numeric,
  'Cash refund receipt debits Cash'
);

SELECT extensions.is(
  (SELECT round(sum(jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'operating_expense_refund'
     AND je.source_id = (SELECT id FROM public.operating_expense_refunds WHERE reference_number = 'SUPPLIER-REFUND-001')
     AND coa.code = '2000'),
  25.00::numeric,
  'Supplier refund credits Accounts Payable to clear the debit balance'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit - jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   WHERE je.source_type IN ('operating_expense', 'operating_expense_payment', 'operating_expense_reversal', 'operating_expense_refund')
     AND je.source_id IN (
       (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001'),
       (SELECT id FROM public.operating_expense_reversals WHERE operating_expense_id =
         (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001')),
       (SELECT id FROM public.operating_expense_payments WHERE operating_expense_id =
         (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001')),
       (SELECT id FROM public.operating_expense_refunds WHERE reference_number = 'SUPPLIER-REFUND-001')
     )),
  0::numeric,
  'Expense recognition, payments, reversal and supplier refund journals remain balanced'
);

SELECT extensions.lives_ok(
  $ SELECT public.record_operating_expense_refund(
    (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001'),
    25.00, CURRENT_DATE, 'cash', 'SUPPLIER-REFUND-001',
    'e0000000-0000-4000-8000-000000000108'
  ) $,
  'Retrying the same supplier refund is idempotent'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.operating_expense_refunds r
   JOIN public.operating_expenses e ON e.id = r.operating_expense_id
   WHERE e.reference_number = 'OPEX-TEST-001'),
  1,
  'Idempotent supplier refund retry does not duplicate cash or journal entries'
);

SELECT extensions.throws_ok(
  $ SELECT public.record_operating_expense_refund(
    (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001'),
    76.00, CURRENT_DATE, 'bank_transfer', 'SUPPLIER-REFUND-OVER-001',
    'e0000000-0000-4000-8000-000000000109'
  ) $,
  'P0001',
  'Refund exceeds the amount actually paid to the supplier and not yet refunded',
  'Supplier refunds cannot exceed the amount actually paid and not already refunded'
);

SELECT extensions.throws_ok(
  $ UPDATE public.operating_expense_refunds
     SET reference_number = 'ALTERED-REFUND'
     WHERE reference_number = 'SUPPLIER-REFUND-001' $,
  'P0001',
  'Posted supplier refunds are immutable; record a separately approved correction',
  'Posted supplier refund evidence cannot be edited'
);

SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);

SELECT extensions.throws_ok(
  $ SELECT public.record_operating_expense_refund(
    (SELECT id FROM public.operating_expenses WHERE reference_number = 'OPEX-TEST-001'),
    1.00, CURRENT_DATE, 'cash', 'SUPPLIER-REFUND-UNAUTH-001',
    'e0000000-0000-4000-8000-000000000110'
  ) $,
  'P0001',
  'Only an admin or accountant can record supplier refunds',
  'Cashier cannot record supplier refunds'
);

SELECT extensions.finish();
ROLLBACK;
