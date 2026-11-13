CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;

SELECT extensions.plan(63);

-- Isolated fixture users. The JWT subject setting exercises the same auth.uid()
-- and user_roles checks used by authenticated RPC calls.
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'inventory-accountant-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('d0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'inventory-cashier-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.user_roles (user_id, role)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'accountant'),
  ('d0000000-0000-4000-8000-000000000002', 'cashier');

INSERT INTO public.products (
  sku, name, current_price, cost_price, cost_price_verified,
  stock_quantity, is_service, is_active
)
VALUES
  ('TEST-DAMAGE-001', 'Damage workflow test product', 20, 8.25, true, 10, false, true),
  ('TEST-DAMAGE-002', 'Unverified damage test product', 20, 8.25, false, 10, false, true),
  ('TEST-PURCHASE-001', 'Stock purchase test product', 20, NULL, false, 0, false, true);

INSERT INTO public.products (
  sku, name, current_price, cost_price, cost_price_verified,
  stock_quantity, is_service, is_active
)
VALUES ('TEST-TYPE-001', 'Unused product type test', 15, NULL, false, 0, false, true);

INSERT INTO public.customers (code, name)
VALUES ('TEST-CUSTOMER-001', 'Inventory test customer');

INSERT INTO public.invoices (
  invoice_number, customer_id, status, issue_date,
  subtotal, tax_amount, total_amount, balance_due
)
SELECT 'INV-TEST-STOCK-001', id, 'draft', CURRENT_DATE, 100, 0, 100, 100
FROM public.customers WHERE code = 'TEST-CUSTOMER-001';

INSERT INTO public.invoice_items (
  invoice_id, product_id, description, quantity, unit_price, line_total
)
SELECT i.id, p.id, 'Two units from verified stock', 2, 50, 100
FROM public.invoices i
JOIN public.products p ON p.sku = 'TEST-PURCHASE-001'
WHERE i.invoice_number = 'INV-TEST-STOCK-001';

INSERT INTO public.invoices (
  invoice_number, customer_id, status, issue_date,
  subtotal, tax_amount, total_amount, balance_due
)
SELECT 'INV-TEST-STOCK-002', id, 'draft', CURRENT_DATE, 250, 0, 250, 250
FROM public.customers WHERE code = 'TEST-CUSTOMER-001';

INSERT INTO public.invoice_items (
  invoice_id, product_id, description, quantity, unit_price, line_total
)
SELECT i.id, p.id, 'Insufficient stock test line', 5, 50, 250
FROM public.invoices i
JOIN public.products p ON p.sku = 'TEST-PURCHASE-001'
WHERE i.invoice_number = 'INV-TEST-STOCK-002';

INSERT INTO public.products (
  sku, name, current_price, cost_price, cost_price_verified,
  stock_quantity, is_service, is_active
)
VALUES ('TEST-SERVICE-001', 'Direct service cost test item', 100, NULL, false, 0, true, true);

INSERT INTO public.invoices (
  invoice_number, customer_id, status, issue_date,
  subtotal, tax_amount, total_amount, balance_due
)
SELECT 'INV-TEST-SERVICE-001', id, 'draft', CURRENT_DATE, 100, 0, 100, 100
FROM public.customers WHERE code = 'TEST-CUSTOMER-001';

INSERT INTO public.invoice_items (
  invoice_id, product_id, description, quantity, unit_price, line_total
)
SELECT i.id, p.id, 'Service labour and materials', 1, 100, 100
FROM public.invoices i
JOIN public.products p ON p.sku = 'TEST-SERVICE-001'
WHERE i.invoice_number = 'INV-TEST-SERVICE-001';

SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT extensions.throws_ok(
  $$ INSERT INTO public.products (
       sku, name, current_price, cost_price, stock_quantity, is_service, is_active
     ) VALUES (
       'TEST-UNRECORDED-OPENING-001', 'Unrecorded opening stock', 25, 10, 5, false, true
     ) $$,
  'P0001',
  'New products must start with zero stock and no purchase cost; record an evidenced stock purchase in Inventory',
  'Authenticated users cannot create products with unrecorded stock or purchase costs'
);

SELECT extensions.lives_ok(
  $$ INSERT INTO public.products (
       sku, name, current_price, cost_price, stock_quantity, is_service, is_active
     ) VALUES (
       'TEST-CATALOGUE-ONLY-001', 'Catalogue-only product', 25, NULL, 0, false, true
     ) $$,
  'Authenticated users can create a catalogue product without opening inventory'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku = 'TEST-CATALOGUE-ONLY-001'),
  0,
  'Catalogue-only product starts with zero stock'
);

SELECT extensions.is(
  (SELECT cost_price FROM public.products WHERE sku = 'TEST-CATALOGUE-ONLY-001'),
  NULL::numeric,
  'Catalogue-only product starts without a purchase cost'
);


SELECT extensions.lives_ok(
  $$ SELECT public.record_inventory_damage(
    (SELECT id FROM public.products WHERE sku = 'TEST-DAMAGE-001'),
    3,
    'DAMAGE-TEST-001',
    'd0000000-0000-4000-8000-000000000101',
    'pgTAP inventory damage test'
  ) $$,
  'Accountant can record evidenced damage'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku = 'TEST-DAMAGE-001'),
  7,
  'Damage reduces physical stock by the recorded quantity'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.inventory_transactions
   WHERE reference_number = 'DAMAGE-TEST-001' AND type = 'damage'),
  1,
  'Damage creates one immutable inventory transaction'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.journal_entries
   WHERE source_type = 'inventory_damage'
     AND source_id = (SELECT id FROM public.inventory_transactions WHERE reference_number = 'DAMAGE-TEST-001')),
  1,
  'Damage creates one linked journal entry'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit - jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   WHERE je.source_type = 'inventory_damage'
     AND je.source_id = (SELECT id FROM public.inventory_transactions WHERE reference_number = 'DAMAGE-TEST-001')),
  0::numeric,
  'Damage journal entry is balanced'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_inventory_damage(
    (SELECT id FROM public.products WHERE sku = 'TEST-DAMAGE-001'),
    3,
    'DAMAGE-TEST-001',
    'd0000000-0000-4000-8000-000000000101',
    'pgTAP retry'
  ) $$,
  'Retry with the same idempotency key is accepted'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.inventory_transactions
   WHERE reference_number = 'DAMAGE-TEST-001' AND type = 'damage'),
  1,
  'Idempotent retry does not create a duplicate transaction'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku = 'TEST-DAMAGE-001'),
  7,
  'Idempotent retry does not decrement stock twice'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_stock_purchase(
    (SELECT id FROM public.products WHERE sku = 'TEST-PURCHASE-001'),
    4, 7.50, 'Test supplier', 'PURCHASE-TEST-001', 10.00,
    'cash', 'Initial test purchase', NULL,
    'd0000000-0000-4000-8000-000000000201'
  ) $$,
  'Accountant can record an evidenced stock purchase'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku = 'TEST-PURCHASE-001'),
  4,
  'Stock purchase increases physical quantity'
);

SELECT extensions.is(
  (SELECT cost_price FROM public.products WHERE sku = 'TEST-PURCHASE-001'),
  7.5000::numeric,
  'First purchase establishes verified unit cost'
);

SELECT extensions.ok(
  (SELECT cost_price_verified FROM public.products WHERE sku = 'TEST-PURCHASE-001'),
  'Purchase evidence marks the product cost as verified'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_stock_purchase(
    (SELECT id FROM public.products WHERE sku = 'TEST-PURCHASE-001'),
    4, 7.50, 'Test supplier', 'PURCHASE-TEST-001', 10.00,
    'cash', 'Initial test purchase', NULL,
    'd0000000-0000-4000-8000-000000000201'
  ) $$,
  'Retry with the same stock-purchase idempotency key is accepted'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.inventory_transactions
   WHERE reference_number = 'PURCHASE-TEST-001' AND type = 'purchase'),
  1,
  'Idempotent purchase retry does not duplicate inventory transactions'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku = 'TEST-PURCHASE-001'),
  4,
  'Idempotent purchase retry does not increase stock twice'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_stock_purchase(
    (SELECT id FROM public.products WHERE sku = 'TEST-PURCHASE-001'),
    2, 9.00, 'Test supplier', 'PURCHASE-TEST-002', 18.00,
    'bank_transfer', 'Second test purchase', NULL,
    'd0000000-0000-4000-8000-000000000202'
  ) $$,
  'A subsequent stock purchase is posted successfully'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku = 'TEST-PURCHASE-001'),
  6,
  'Subsequent purchase adds the received quantity'
);

SELECT extensions.is(
  (SELECT cost_price FROM public.products WHERE sku = 'TEST-PURCHASE-001'),
  8.0000::numeric,
  'Weighted-average purchase cost is recalculated correctly'
);

SELECT extensions.is(
  (SELECT round(sum(jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.inventory_transactions it ON it.id = je.source_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'stock_purchase'
     AND it.reference_number = 'PURCHASE-TEST-001'
     AND coa.code = '1000'),
  10.00::numeric,
  'Part-paid stock purchase credits cash for the amount actually paid'
);

SELECT extensions.is(
  (SELECT round(sum(jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.inventory_transactions it ON it.id = je.source_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'stock_purchase'
     AND it.reference_number = 'PURCHASE-TEST-001'
     AND coa.code = '2000'),
  20.00::numeric,
  'Unpaid stock purchase balance is recorded in Accounts Payable'
);

SELECT extensions.is(
  (SELECT round(sum(jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.inventory_transactions it ON it.id = je.source_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'stock_purchase'
     AND it.reference_number = 'PURCHASE-TEST-002'
     AND coa.code = '1010'),
  18.00::numeric,
  'Bank-paid stock purchase credits the bank account'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.journal_entries je
    JOIN public.inventory_transactions it
      ON it.id = je.source_id AND it.type = 'purchase'
    JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.source_type = 'stock_purchase'
    GROUP BY je.id
    HAVING round(sum(jl.debit - jl.credit), 2) <> 0
  ),
  'Every stock-purchase journal is balanced'
);

SELECT extensions.lives_ok(
  $$ UPDATE public.invoices
     SET status = 'issued'
     WHERE invoice_number = 'INV-TEST-STOCK-001' $$,
  'Invoice with available verified stock can be issued'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.journal_entries
   WHERE source_type = 'invoice'
     AND source_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-TEST-STOCK-001')),
  1,
  'Issuing an invoice automatically creates exactly one linked journal entry'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'invoice'
     AND je.source_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-TEST-STOCK-001')
     AND coa.code = '1100'),
  100.00::numeric,
  'Invoice issue posts accounts receivable'
);

SELECT extensions.is(
  (SELECT round(sum(jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE je.source_type = 'invoice'
     AND je.source_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-TEST-STOCK-001')
     AND coa.code = '4000'),
  100.00::numeric,
  'Invoice issue posts sales revenue'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku = 'TEST-PURCHASE-001'),
  4,
  'Invoice journal reduces stock exactly once'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.inventory_transactions
   WHERE type = 'sale' AND reference_type = 'invoice'
     AND reference_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-TEST-STOCK-001')),
  1,
  'Invoice creates one linked stock-sale transaction'
);

SELECT extensions.throws_ok(
  $$ UPDATE public.inventory_transactions
     SET quantity = quantity + 1
     WHERE type = 'sale' AND reference_type = 'invoice'
       AND reference_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-TEST-STOCK-001') $$,
  'P0001',
  'An inventory transaction with a posted journal is immutable; record an audited reversal instead',
  'Invoice-linked stock-sale movement cannot be edited after posting'
);

SELECT extensions.throws_ok(
  $$ DELETE FROM public.inventory_transactions
     WHERE type = 'sale' AND reference_type = 'invoice'
       AND reference_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-TEST-STOCK-001') $$,
  'P0001',
  'An inventory transaction with a posted journal is immutable; record an audited reversal instead',
  'Invoice-linked stock-sale movement cannot be deleted after posting'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   JOIN public.invoices i ON i.id = je.source_id
   WHERE je.source_type = 'invoice' AND i.invoice_number = 'INV-TEST-STOCK-001'
     AND coa.code = '5000'),
  16.00::numeric,
  'Invoice posts COGS from the verified weighted-average cost snapshot'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit - jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.invoices i ON i.id = je.source_id
   WHERE je.source_type = 'invoice' AND i.invoice_number = 'INV-TEST-STOCK-001'),
  0::numeric,
  'Invoice revenue and COGS journal remains balanced'
);

SELECT extensions.lives_ok(
  $$ UPDATE public.invoices
     SET status = 'issued'
     WHERE invoice_number = 'INV-TEST-SERVICE-001' $$,
  'Service invoice can be issued without inventory movement'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_invoice_item_direct_cost(
    (SELECT ii.id FROM public.invoice_items ii
     JOIN public.invoices i ON i.id = ii.invoice_id
     WHERE i.invoice_number = 'INV-TEST-SERVICE-001'),
    30.00, 'SERVICE-COST-TEST-001', CURRENT_DATE,
    'cash', 'Service labour and materials'
  ) $$,
  'Accountant can post an evidenced direct service cost'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.invoice_item_direct_costs dc
   JOIN public.invoice_items ii ON ii.id = dc.invoice_item_id
   JOIN public.invoices i ON i.id = ii.invoice_id
   WHERE i.invoice_number = 'INV-TEST-SERVICE-001'),
  1,
  'Direct service cost is linked to the invoice line'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   JOIN public.invoice_items ii ON ii.id = je.source_id
   JOIN public.invoices i ON i.id = ii.invoice_id
   WHERE je.source_type = 'direct_invoice_cost'
     AND i.invoice_number = 'INV-TEST-SERVICE-001'
     AND coa.code = '5000'),
  30.00::numeric,
  'Direct service cost is posted to Cost of Goods Sold'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.inventory_transactions it
   JOIN public.products p ON p.id = it.product_id
   WHERE p.sku = 'TEST-SERVICE-001'),
  0,
  'Service direct costs do not create inventory transactions'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit - jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   WHERE je.source_type = 'direct_invoice_cost'
     AND je.source_id = (SELECT ii.id FROM public.invoice_items ii
                         JOIN public.invoices i ON i.id = ii.invoice_id
                         WHERE i.invoice_number = 'INV-TEST-SERVICE-001')),
  0::numeric,
  'Direct service cost journal is balanced'
);

SELECT extensions.throws_ok(
  $$ SELECT public.record_invoice_item_direct_cost(
    (SELECT ii.id FROM public.invoice_items ii
     JOIN public.invoices i ON i.id = ii.invoice_id
     WHERE i.invoice_number = 'INV-TEST-SERVICE-001'),
    30.00, 'SERVICE-COST-TEST-001', CURRENT_DATE,
    'cash', 'Duplicate service cost'
  ) $$,
  'P0001',
  'A direct cost has already been recorded for this invoice line',
  'Duplicate direct service cost is rejected'
);

SELECT extensions.throws_ok(
  $$ UPDATE public.invoices
     SET status = 'issued'
     WHERE invoice_number = 'INV-TEST-STOCK-002' $$,
  'P0001',
  'Insufficient stock for Stock purchase test product. Available: 4, requested: 5.000',
  'Invoice issue is rejected when stock is insufficient'
);

SELECT extensions.is(
  (SELECT status::text FROM public.invoices WHERE invoice_number = 'INV-TEST-STOCK-002'),
  'draft',
  'Rejected invoice issue leaves the invoice in draft'
);

SELECT extensions.throws_ok(
  $$ UPDATE public.products
     SET is_service = true
     WHERE sku = 'TEST-PURCHASE-001' $$,
  'P0001',
  'Product type cannot be changed after stock or invoice history exists; create a correctly classified item and use an audited correction',
  'A product with inventory or invoice history cannot be reclassified as a service'
);

SELECT extensions.lives_ok(
  $$ UPDATE public.products
     SET is_service = true
     WHERE sku = 'TEST-TYPE-001' $$,
  'An unused product without stock or invoice history can be reclassified'
);

SELECT extensions.ok(
  (SELECT is_service FROM public.products WHERE sku = 'TEST-TYPE-001'),
  'Allowed product type correction is saved'
);

SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000002', true);

SELECT extensions.throws_ok(
  $$ SELECT public.record_inventory_damage(
    (SELECT id FROM public.products WHERE sku = 'TEST-DAMAGE-001'),
    1,
    'DAMAGE-CASHIER-001',
    'd0000000-0000-4000-8000-000000000102',
    NULL
  ) $$,
  'P0001',
  'Only an admin or accountant can record stock damage',
  'Cashier cannot post stock damage'
);

SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);

SELECT extensions.throws_ok(
  $$ SELECT public.record_inventory_damage(
    (SELECT id FROM public.products WHERE sku = 'TEST-DAMAGE-002'),
    1,
    'DAMAGE-UNVERIFIED-001',
    'd0000000-0000-4000-8000-000000000103',
    NULL
  ) $$,
  'P0001',
  'Verify the actual purchase cost before recording inventory damage',
  'Unverified purchase cost cannot be written off'
);


SELECT extensions.lives_ok(
  $$ INSERT INTO public.petty_cash_transactions (
       date, description, amount, type, category, reference_number,
       recorded_by, payment_method
     ) VALUES (
       CURRENT_DATE, 'Test petty cash expense', 12.50, 'expense',
       'Office', 'PETTY-IMMUTABLE-001',
       'd0000000-0000-4000-8000-000000000001', 'cash'
     ) $$,
  'Accountant can record an evidenced petty-cash expense'
);

SELECT extensions.throws_ok(
  $$ UPDATE public.petty_cash_transactions
     SET amount = 15.00
     WHERE reference_number = 'PETTY-IMMUTABLE-001' $$,
  'P0001',
  'An expense with a posted journal is immutable; record an audited reversal instead',
  'Posted petty-cash expense cannot be edited'
);

SELECT extensions.throws_ok(
  $$ DELETE FROM public.petty_cash_transactions
     WHERE reference_number = 'PETTY-IMMUTABLE-001' $$,
  'P0001',
  'An expense with a posted journal is immutable; record an audited reversal instead',
  'Posted petty-cash expense cannot be deleted'
);


SELECT extensions.lives_ok(
  $ SELECT public.reverse_petty_cash_expense(
       (SELECT id FROM public.petty_cash_transactions WHERE reference_number = 'PETTY-IMMUTABLE-001'),
       CURRENT_DATE, 'cash', 'Supplier returned petty cash expense',
       'PETTY-REFUND-001',
       'd0000000-0000-4000-8000-000000000201'
     ) $,
  'Accountant can reverse a petty-cash expense with a refund reference'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.petty_cash_expense_reversals r
   JOIN public.petty_cash_transactions p ON p.id = r.petty_cash_transaction_id
   WHERE p.reference_number = 'PETTY-IMMUTABLE-001'),
  1,
  'Petty-cash reversal creates one immutable audit record'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit - jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   WHERE je.source_type = 'petty_cash_expense_reversal'
     AND je.source_id = (SELECT id FROM public.petty_cash_transactions
                         WHERE reference_number = 'PETTY-IMMUTABLE-001')),
  0::numeric,
  'Petty-cash reversal journal is balanced'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   WHERE je.source_type = 'petty_cash_expense_reversal'
     AND je.source_id = (SELECT id FROM public.petty_cash_transactions
                         WHERE reference_number = 'PETTY-IMMUTABLE-001')),
  12.50::numeric,
  'Petty-cash reversal debits cash for the actual refund amount'
);

SELECT extensions.is(
  public.reverse_petty_cash_expense(
    (SELECT id FROM public.petty_cash_transactions WHERE reference_number = 'PETTY-IMMUTABLE-001'),
    CURRENT_DATE, 'cash', 'Supplier returned petty cash expense',
    'PETTY-REFUND-001',
    'd0000000-0000-4000-8000-000000000201'
  ),
  (SELECT id FROM public.petty_cash_expense_reversals
   WHERE reference_number = 'PETTY-REFUND-001'),
  'Petty-cash reversal retry with identical details is idempotent'
);

SELECT extensions.throws_ok(
  $ SELECT public.reverse_petty_cash_expense(
       (SELECT id FROM public.petty_cash_transactions WHERE reference_number = 'PETTY-IMMUTABLE-001'),
       CURRENT_DATE, 'cash', 'Duplicate reversal',
       'PETTY-REFUND-002',
       'd0000000-0000-4000-8000-000000000202'
     ) $,
  'P0001',
  'This petty-cash expense has already been reversed',
  'A petty-cash expense cannot be reversed twice'
);

SELECT extensions.throws_ok(
  $ UPDATE public.petty_cash_expense_reversals
     SET reason = 'Changed after posting'
     WHERE reference_number = 'PETTY-REFUND-001' $,
  'P0001',
  'Posted petty-cash expense reversals are immutable',
  'Petty-cash reversal evidence cannot be edited'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.petty_cash_transactions
   WHERE reference_number = 'PETTY-IMMUTABLE-001' AND amount = 12.50),
  1,
  'Original petty-cash expense is preserved after reversal'
);

SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000002', true);

SELECT extensions.throws_ok(
  $ SELECT public.reverse_petty_cash_expense(
       (SELECT id FROM public.petty_cash_transactions WHERE reference_number = 'PETTY-IMMUTABLE-001'),
       CURRENT_DATE, 'cash', 'Cashier must not reverse',
       'PETTY-REFUND-CASHIER',
       'd0000000-0000-4000-8000-000000000203'
     ) $,
  'P0001',
  'Only an admin or accountant can reverse petty-cash expenses',
  'Cashier cannot reverse petty-cash expenses'
);

SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);


SELECT extensions.throws_ok(
  $ SELECT public.reverse_petty_cash_expense(
       (SELECT id FROM public.petty_cash_transactions WHERE reference_number = 'PETTY-IMMUTABLE-001'),
       CURRENT_DATE - 1, 'cash', 'Invalid earlier refund date',
       'PETTY-REFUND-EARLY',
       'd0000000-0000-4000-8000-000000000204'
     ) $,
  'P0001',
  'Refund date cannot be earlier than the original petty-cash expense date',
  'Petty-cash reversal cannot predate the original expense'
);

SELECT * FROM extensions.finish();

ROLLBACK;
