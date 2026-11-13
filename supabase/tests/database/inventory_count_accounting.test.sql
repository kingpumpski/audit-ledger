CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(11);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('d1000000-0000-4000-8000-000000000001','authenticated','authenticated',
   'stock-count-accountant@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb),
  ('d1000000-0000-4000-8000-000000000002','authenticated','authenticated',
   'stock-count-cashier@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb);

INSERT INTO public.user_roles(user_id, role) VALUES
  ('d1000000-0000-4000-8000-000000000001','accountant'),
  ('d1000000-0000-4000-8000-000000000002','cashier');

INSERT INTO public.products (
  sku, name, current_price, cost_price, cost_price_verified,
  stock_quantity, is_service, is_active
) VALUES
  ('TEST-COUNT-POS-001','Positive count test item',20,5,true,10,false,true),
  ('TEST-COUNT-NEG-001','Negative count test item',20,5,true,10,false,true),
  ('TEST-COUNT-DATE-001','Count date test item',20,5,true,10,false,true);

INSERT INTO public.inventory_transactions (
  product_id, type, quantity, previous_quantity, new_quantity,
  unit_cost, total_cost, reference_type, reference_number, created_at
)
SELECT id,'purchase',1,9,10,5,5,'test','COUNT-DATE-MOVEMENT',now()
FROM public.products WHERE sku='TEST-COUNT-DATE-001';

SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

SELECT extensions.lives_ok(
  $$ SELECT public.record_stock_count_adjustment(
    (SELECT id FROM public.products WHERE sku='TEST-COUNT-POS-001'),
    12, CURRENT_DATE, 'Physical count found two additional units',
    'COUNT-SHEET-POS-001',
    'd1000000-0000-4000-8000-000000000101'
  ) $$,
  'Accountant can post an evidenced positive stock-count correction'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku='TEST-COUNT-POS-001'),
  12,
  'Positive count correction updates the stock balance to the counted quantity'
);

SELECT extensions.is(
  (SELECT quantity_delta FROM public.inventory_count_adjustments
   WHERE reference_number='COUNT-SHEET-POS-001'),
  2,
  'Count audit record preserves the exact positive variance'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit-jl.credit),2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   JOIN public.inventory_transactions it ON it.id=je.source_id
   WHERE je.source_type='inventory_count_adjustment'
     AND it.reference_number='COUNT-SHEET-POS-001'),
  0::numeric,
  'Positive count correction posts a balanced journal'
);

SELECT extensions.is(
  (SELECT round(sum(jl.credit),2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   JOIN public.inventory_transactions it ON it.id=je.source_id
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='inventory_count_adjustment'
     AND it.reference_number='COUNT-SHEET-POS-001' AND coa.code='4900'),
  10.00::numeric,
  'Positive variance credits the inventory count gain account at verified cost'
);

SELECT extensions.throws_ok(
  $$ UPDATE public.inventory_count_adjustments
     SET reason='Altered after posting'
     WHERE reference_number='COUNT-SHEET-POS-001' $$,
  'P0001',
  'Posted stock-count adjustments are immutable',
  'Posted count audit evidence cannot be edited'
);

SELECT extensions.throws_ok(
  $$ SELECT public.record_stock_count_adjustment(
    (SELECT id FROM public.products WHERE sku='TEST-COUNT-POS-001'),
    13, CURRENT_DATE, 'Different retry details',
    'COUNT-SHEET-POS-001',
    'd1000000-0000-4000-8000-000000000101'
  ) $$,
  'P0001',
  'This stock-count idempotency key was already used with different details',
  'Idempotency key cannot be reused with altered count details'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_stock_count_adjustment(
    (SELECT id FROM public.products WHERE sku='TEST-COUNT-NEG-001'),
    8, CURRENT_DATE, 'Physical count identified two missing units',
    'COUNT-SHEET-NEG-001',
    'd1000000-0000-4000-8000-000000000102'
  ) $$,
  'Accountant can post an evidenced stock shortage'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit),2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   JOIN public.inventory_transactions it ON it.id=je.source_id
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='inventory_count_adjustment'
     AND it.reference_number='COUNT-SHEET-NEG-001' AND coa.code='6500'),
  10.00::numeric,
  'Negative variance debits inventory shrinkage expense at verified cost'
);

SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
SELECT extensions.throws_ok(
  $$ SELECT public.record_stock_count_adjustment(
    (SELECT id FROM public.products WHERE sku='TEST-COUNT-NEG-001'),
    9, CURRENT_DATE, 'Cashier must not approve a stock count',
    'COUNT-SHEET-CASHIER-001',
    'd1000000-0000-4000-8000-000000000103'
  ) $$,
  'P0001',
  'Only an admin or accountant can approve stock-count corrections',
  'Cashier cannot approve stock-count corrections'
);

SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
SELECT extensions.throws_ok(
  $$ SELECT public.record_stock_count_adjustment(
    (SELECT id FROM public.products WHERE sku='TEST-COUNT-DATE-001'),
    9, CURRENT_DATE - 1, 'Attempt to backdate after an inventory movement',
    'COUNT-SHEET-BACKDATED-001',
    'd1000000-0000-4000-8000-000000000104'
  ) $$,
  'P0001',
  'The count date cannot predate the latest recorded inventory movement',
  'Stock-count corrections cannot be backdated before the latest movement'
);

SELECT * FROM extensions.finish();
ROLLBACK;
