CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(15);

INSERT INTO auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data
) VALUES (
  'ca100000-0000-4000-8000-000000000001','authenticated','authenticated',
  'customer-balance-accountant@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb
);
INSERT INTO public.user_roles(user_id,role)
VALUES ('ca100000-0000-4000-8000-000000000001','accountant');
SELECT set_config('request.jwt.claim.sub','ca100000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

INSERT INTO public.customers(code,name)
VALUES('CAB-001','Customer balance as-of test');

INSERT INTO public.invoices(
  invoice_number,customer_id,status,issue_date,subtotal,tax_amount,total_amount,amount_paid,balance_due
)
SELECT 'CAB-INV-001',id,'issued',CURRENT_DATE-20,100,0,100,0,100
FROM public.customers WHERE code='CAB-001';
INSERT INTO public.invoices(
  invoice_number,customer_id,status,issue_date,subtotal,tax_amount,total_amount,amount_paid,balance_due
)
SELECT 'CAB-INV-002',id,'issued',CURRENT_DATE-7,200,0,200,0,200
FROM public.customers WHERE code='CAB-001';

INSERT INTO public.journal_entries(entry_number,entry_date,description,source_type,source_id,currency,created_by)
SELECT 'CAB-JE-001',CURRENT_DATE-20,'Test invoice 1','invoice',id,'USD','ca100000-0000-4000-8000-000000000001'
FROM public.invoices WHERE invoice_number='CAB-INV-001';
INSERT INTO public.journal_entries(entry_number,entry_date,description,source_type,source_id,currency,created_by)
SELECT 'CAB-JE-002',CURRENT_DATE-7,'Test invoice 2','invoice',id,'USD','ca100000-0000-4000-8000-000000000001'
FROM public.invoices WHERE invoice_number='CAB-INV-002';

INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
SELECT je.id,1,ar.id,'Accounts receivable',i.total_amount,0
FROM public.journal_entries je
JOIN public.invoices i ON i.id=je.source_id
JOIN public.chart_of_accounts ar ON ar.code='1100'
WHERE je.entry_number IN ('CAB-JE-001','CAB-JE-002');
INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
SELECT je.id,2,revenue.id,'Sales revenue',0,i.total_amount
FROM public.journal_entries je
JOIN public.invoices i ON i.id=je.source_id
JOIN public.chart_of_accounts revenue ON revenue.code='4000'
WHERE je.entry_number IN ('CAB-JE-001','CAB-JE-002');

INSERT INTO public.payments(payment_number,invoice_id,customer_id,amount,payment_method,payment_date)
SELECT 'CAB-PAY-001',i.id,i.customer_id,40,'credit_card',CURRENT_DATE-15
FROM public.invoices i WHERE i.invoice_number='CAB-INV-001';
INSERT INTO public.payments(payment_number,invoice_id,customer_id,amount,payment_method,payment_date)
SELECT 'CAB-PAY-002',i.id,i.customer_id,60,'mobile_payment',CURRENT_DATE-5
FROM public.invoices i WHERE i.invoice_number='CAB-INV-001';
INSERT INTO public.payments(payment_number,invoice_id,customer_id,amount,payment_method,payment_date)
SELECT 'CAB-PAY-003',i.id,i.customer_id,50,'check',CURRENT_DATE-1
FROM public.invoices i WHERE i.invoice_number='CAB-INV-002';

SELECT extensions.is(
  (SELECT outstanding_balance FROM public.get_customer_account_balances(CURRENT_DATE-10)
   WHERE customer_code='CAB-001'),
  60.00::numeric,
  'As-of balance includes only payments received by the selected historical date'
);
SELECT extensions.is(
  (SELECT outstanding_balance FROM public.get_customer_account_balances(CURRENT_DATE-3)
   WHERE customer_code='CAB-001'),
  200.00::numeric,
  'As-of balance includes invoices issued by the date but excludes later receipts'
);
SELECT extensions.is(
  (SELECT outstanding_balance FROM public.get_customer_account_balances(CURRENT_DATE)
   WHERE customer_code='CAB-001'),
  150.00::numeric,
  'Current outstanding receivable reflects all posted invoice payments'
);

SELECT extensions.is(
  (SELECT coa.code
   FROM public.journal_entries je
   JOIN public.journal_lines jl ON jl.journal_entry_id=je.id AND jl.debit>0
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='payment' AND je.source_id=(SELECT id FROM public.payments WHERE payment_number='CAB-PAY-001')),
  '1020'::text,
  'Credit-card receipts post to Card Settlement Clearing'
);
SELECT extensions.is(
  (SELECT coa.code
   FROM public.journal_entries je
   JOIN public.journal_lines jl ON jl.journal_entry_id=je.id AND jl.debit>0
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='payment' AND je.source_id=(SELECT id FROM public.payments WHERE payment_number='CAB-PAY-002')),
  '1030'::text,
  'Mobile-money receipts post to Mobile Money Clearing'
);
SELECT extensions.is(
  (SELECT coa.code
   FROM public.journal_entries je
   JOIN public.journal_lines jl ON jl.journal_entry_id=je.id AND jl.debit>0
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='payment' AND je.source_id=(SELECT id FROM public.payments WHERE payment_number='CAB-PAY-003')),
  '1040'::text,
  'Cheque receipts post to Undeposited Cheques'
);

SELECT extensions.throws_ok(
  $$ INSERT INTO public.payments(payment_number,invoice_id,customer_id,amount,payment_method,payment_date)
     SELECT 'CAB-PAY-OTHER',i.id,i.customer_id,1,'other',CURRENT_DATE
     FROM public.invoices i WHERE i.invoice_number='CAB-INV-002' $$,
  'P0001',
  'Unconfigured payment method other is rejected instead of being misposted to Bank Operating'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.payments WHERE payment_number='CAB-PAY-OTHER'),
  0::bigint,
  'Rejected payment method leaves no payment record'
);

SELECT extensions.lives_ok(
  $ SELECT public.settle_payment_clearing_account(
    '1020',40,1,CURRENT_DATE,'CARD-PROVIDER-SETTLEMENT-001','BANK-STATEMENT-001',
    'ca100000-0000-4000-8000-000000000101','Card settlement with processor fees'
  ) $,
  'Card settlement is recorded with its journal'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.payment_clearing_settlements WHERE provider_reference='CARD-PROVIDER-SETTLEMENT-001'),
  1::bigint,
  'One immutable settlement record is created'
);
SELECT extensions.is(
  (SELECT clearing_balance FROM public.get_payment_clearing_balances() WHERE account_code='1020'),
  0.00::numeric,
  'Settlement clears the matched gross amount from the card clearing balance'
);
SELECT extensions.is(
  (SELECT ROUND(SUM(jl.debit-jl.credit),2)
   FROM public.journal_entries je JOIN public.journal_lines jl ON jl.journal_entry_id=je.id
   WHERE je.source_type='payment_clearing_settlement'
     AND je.source_id=(SELECT id FROM public.payment_clearing_settlements WHERE provider_reference='CARD-PROVIDER-SETTLEMENT-001')),
  0.00::numeric,
  'Settlement journal is balanced'
);
SELECT extensions.is(
  (SELECT ROUND(jl.debit,2)
   FROM public.journal_entries je
   JOIN public.journal_lines jl ON jl.journal_entry_id=je.id
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='payment_clearing_settlement'
     AND je.source_id=(SELECT id FROM public.payment_clearing_settlements WHERE provider_reference='CARD-PROVIDER-SETTLEMENT-001')
     AND coa.code='1010'),
  39.00::numeric,
  'Net settlement after processor fees is debited to Bank Operating'
);
SELECT extensions.is(
  (SELECT ROUND(jl.debit,2)
   FROM public.journal_entries je
   JOIN public.journal_lines jl ON jl.journal_entry_id=je.id
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='payment_clearing_settlement'
     AND je.source_id=(SELECT id FROM public.payment_clearing_settlements WHERE provider_reference='CARD-PROVIDER-SETTLEMENT-001')
     AND coa.code='6400'),
  1.00::numeric,
  'Processor fee is separately recognized as a settlement expense'
);

SELECT extensions.throws_ok(
  $ SELECT public.settle_payment_clearing_account(
    '1020',1,0,CURRENT_DATE,'CARD-PROVIDER-OVERSETTLE','BANK-STATEMENT-OVERSETTLE',
    'ca100000-0000-4000-8000-000000000102','Attempt to settle more than the remaining balance'
  ) $,
  'P0001',
  'Settlement cannot exceed the clearing balance available on the selected date'
);

SELECT * FROM extensions.finish();
ROLLBACK;
