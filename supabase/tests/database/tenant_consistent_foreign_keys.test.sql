BEGIN;
SELECT plan(5);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_constraint
   WHERE connamespace='public'::regnamespace
     AND contype='f'
     AND convalidated
     AND conname LIKE 'tenant_fk_%'),
  56,
  'all operational foreign keys have validated tenant-consistent constraints'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_constraint
   WHERE connamespace='public'::regnamespace
     AND contype='f'
     AND convalidated
     AND conname LIKE 'tenant_fk_%'
     AND cardinality(conkey)=2
     AND cardinality(confkey)=2),
  56,
  'each tenant relationship binds both business_id and parent identifier'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace='public'::regnamespace
      AND contype='f'
      AND conname LIKE 'tenant_fk_%'
      AND NOT convalidated
  ),
  'no tenant relationship remains unvalidated'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_indexes
   WHERE schemaname='public'
     AND indexname LIKE 'tenant_ix_%'),
  56,
  'every composite foreign key has a child-side business_id index'
);

SELECT ok(
  (SELECT count(*)=33
   FROM information_schema.columns
   WHERE table_schema='public'
     AND column_name='business_id'
     AND is_nullable='NO'
     AND table_name = ANY(ARRAY[
       'chart_of_accounts','company_settings','credit_note_line_taxes','credit_note_lines',
       'credit_notes','customer_credit_applications','customer_credit_refunds','customers',
       'discounts','financial_completeness_attestations','inventory_count_adjustments',
       'inventory_purchase_reversals','inventory_transactions','invoice_item_direct_costs',
       'invoice_item_taxes','invoice_items','invoice_taxes','invoices','journal_entries',
       'journal_lines','operating_expense_payments','operating_expense_refunds',
       'operating_expense_reversals','operating_expenses','payment_clearing_settlements',
       'payments','petty_cash_expense_reversals','petty_cash_transactions',
       'product_price_history','products','receipts','sequences','taxes'
     ])),
  'all 33 business-owned tables retain mandatory business ownership'
);

SELECT * FROM finish();
ROLLBACK;
