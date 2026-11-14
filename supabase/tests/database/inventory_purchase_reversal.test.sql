CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(15);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('e1000000-0000-4000-8000-000000000001','authenticated','authenticated',
   'purchase-reversal-accountant@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb),
  ('e1000000-0000-4000-8000-000000000002','authenticated','authenticated',
   'purchase-reversal-cashier@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb);

INSERT INTO public.user_roles(user_id, role) VALUES
  ('e1000000-0000-4000-8000-000000000001','accountant'),
  ('e1000000-0000-4000-8000-000000000002','cashier');

INSERT INTO public.products (
  sku, name, current_price, cost_price, cost_price_verified,
  stock_quantity, is_service, is_active
) VALUES
  ('TEST-PURCHASE-REV-001','Purchase reversal test item',15,NULL,false,0,false,true),
  ('TEST-PURCHASE-REV-002','Later movement block test item',15,NULL,false,0,false,true),
  ('TEST-PURCHASE-REV-003','Cashier restriction test item',15,NULL,false,0,false,true);

SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

SELECT extensions.lives_ok(
  $$ SELECT public.record_stock_purchase(
    (SELECT id FROM public.products WHERE sku='TEST-PURCHASE-REV-001'),
    4, 5.00, 'Test supplier', 'PURCHASE-REV-ORIGINAL-001', 10.00,
    'cash', 'Purchase reversal fixture', NULL,
    'e1000000-0000-4000-8000-000000000101'
  ) $$,
  'Accountant can create an evidenced purchase to reverse'
);

SELECT extensions.lives_ok(
  $$ SELECT public.reverse_stock_purchase(
    (SELECT id FROM public.inventory_transactions WHERE reference_number='PURCHASE-REV-ORIGINAL-001'),
    CURRENT_DATE, 'bank_transfer', 'Supplier returned the goods and refunded the paid portion',
    'SUPPLIER-CREDIT-001',
    'e1000000-0000-4000-8000-000000000201'
  ) $$,
  'Accountant can reverse a purchase after the supplier refund is received'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku='TEST-PURCHASE-REV-001'),
  0,
  'Purchase reversal restores the exact prior stock quantity'
);

SELECT extensions.is(
  (SELECT cost_price FROM public.products WHERE sku='TEST-PURCHASE-REV-001'),
  NULL::numeric,
  'Purchase reversal clears valuation when the prior stock balance was zero'
);

SELECT extensions.ok(
  NOT (SELECT cost_price_verified FROM public.products WHERE sku='TEST-PURCHASE-REV-001'),
  'Purchase reversal clears verified-cost status when no stock remains'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit-jl.credit),2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   WHERE je.source_type='stock_purchase_reversal'),
  0::numeric,
  'Purchase reversal posts a balanced journal'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit),2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='stock_purchase_reversal' AND coa.code='1010'),
  10.00::numeric,
  'Supplier cash refund is debited to the evidenced bank account'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit),2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='stock_purchase_reversal' AND coa.code='2000'),
  10.00::numeric,
  'Unpaid supplier balance is reversed against Accounts Payable'
);

SELECT extensions.is(
  (SELECT round(sum(jl.credit),2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='stock_purchase_reversal' AND coa.code='1200'),
  20.00::numeric,
  'Purchase reversal credits Inventory for the original purchase value'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.inventory_transactions
   WHERE reference_number='PURCHASE-REV-ORIGINAL-001' AND type='purchase'),
  1,
  'Original purchase transaction is preserved unchanged'
);

SELECT extensions.is(
  public.reverse_stock_purchase(
    (SELECT id FROM public.inventory_transactions WHERE reference_number='PURCHASE-REV-ORIGINAL-001'),
    CURRENT_DATE, 'bank_transfer', 'Supplier returned the goods and refunded the paid portion',
    'SUPPLIER-CREDIT-001',
    'e1000000-0000-4000-8000-000000000201'
  ),
  (SELECT id FROM public.inventory_purchase_reversals WHERE reference_number='SUPPLIER-CREDIT-001'),
  'Identical reversal retry returns the same audit record'
);

SELECT extensions.throws_ok(
  $$ UPDATE public.inventory_purchase_reversals
     SET reason='Edited after posting'
     WHERE reference_number='SUPPLIER-CREDIT-001' $$,
  'P0001',
  'Posted stock-purchase reversals are immutable',
  'Purchase reversal audit evidence cannot be edited'
);

SELECT extensions.throws_ok(
  $$ SELECT public.reverse_stock_purchase(
    (SELECT id FROM public.inventory_transactions WHERE reference_number='PURCHASE-REV-ORIGINAL-001'),
    CURRENT_DATE, 'bank_transfer', 'Duplicate attempt',
    'SUPPLIER-CREDIT-002',
    'e1000000-0000-4000-8000-000000000202'
  ) $$,
  'P0001',
  'This stock purchase has already been reversed',
  'A stock purchase cannot be reversed twice'
);

SELECT public.record_stock_purchase(
  (SELECT id FROM public.products WHERE sku='TEST-PURCHASE-REV-002'),
  3, 4.00, 'Test supplier', 'PURCHASE-REV-LATER-001', 0,
  'cash', 'Later movement fixture', NULL,
  'e1000000-0000-4000-8000-000000000102'
);

INSERT INTO public.inventory_transactions (
  product_id, type, quantity, previous_quantity, new_quantity,
  unit_cost, total_cost, reference_type, reference_number, created_at
)
SELECT id, 'sale', 1, 3, 2, 4.00, 4.00, 'test',
       'PURCHASE-REV-LATER-MOVEMENT', now() + interval '1 second'
FROM public.products WHERE sku='TEST-PURCHASE-REV-002';

SELECT extensions.throws_ok(
  $$ SELECT public.reverse_stock_purchase(
    (SELECT id FROM public.inventory_transactions WHERE reference_number='PURCHASE-REV-LATER-001'),
    CURRENT_DATE, NULL, 'Attempt to reverse after later movement',
    'SUPPLIER-CREDIT-LATER-001',
    'e1000000-0000-4000-8000-000000000203'
  ) $$,
  'P0001',
  'This purchase cannot be reversed because later inventory movements exist; historical weighted-average costing must not be rewritten',
  'Purchase reversal is blocked after subsequent inventory movement'
);

SELECT public.record_stock_purchase(
  (SELECT id FROM public.products WHERE sku='TEST-PURCHASE-REV-003'),
  2, 6.00, 'Test supplier', 'PURCHASE-REV-CASHIER-001', 0,
  'cash', 'Cashier restriction fixture', NULL,
  'e1000000-0000-4000-8000-000000000103'
);

SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
SELECT extensions.throws_ok(
  $$ SELECT public.reverse_stock_purchase(
    (SELECT id FROM public.inventory_transactions WHERE reference_number='PURCHASE-REV-CASHIER-001'),
    CURRENT_DATE, NULL, 'Cashier cannot reverse',
    'SUPPLIER-CREDIT-CASHIER-001',
    'e1000000-0000-4000-8000-000000000204'
  ) $$,
  'P0001',
  'Only an admin or accountant can reverse stock purchases',
  'Cashier cannot reverse stock purchases'
);

SELECT * FROM extensions.finish();
ROLLBACK;
