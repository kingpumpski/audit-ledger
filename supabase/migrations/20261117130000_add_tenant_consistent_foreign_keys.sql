-- Enforce same-business ownership for every existing operational
-- foreign-key relationship. The original single-column FKs remain in place;
-- these composite constraints add the tenant boundary without changing
-- financial behavior. All pre-tenancy rows were assigned to legacy_workspace
-- in the preceding migration.

DO $tenant_relationships$
DECLARE
  v_fk record;
  v_constraint_name text;
BEGIN
  FOR v_fk IN
    SELECT *
    FROM (VALUES
      ('chart_of_accounts','parent_id','chart_of_accounts'),
      ('credit_note_line_taxes','liability_account_id','chart_of_accounts'),
      ('credit_note_line_taxes','credit_note_line_id','credit_note_lines'),
      ('credit_note_line_taxes','source_invoice_item_tax_id','invoice_item_taxes'),
      ('credit_note_line_taxes','tax_id','taxes'),
      ('credit_note_lines','credit_note_id','credit_notes'),
      ('credit_note_lines','invoice_item_id','invoice_items'),
      ('credit_note_lines','product_id','products'),
      ('credit_notes','customer_id','customers'),
      ('credit_notes','invoice_id','invoices'),
      ('credit_notes','journal_entry_id','journal_entries'),
      ('customer_credit_applications','credit_note_id','credit_notes'),
      ('customer_credit_applications','applied_to_invoice_id','invoices'),
      ('customer_credit_applications','journal_entry_id','journal_entries'),
      ('customer_credit_refunds','credit_note_id','credit_notes'),
      ('customer_credit_refunds','journal_entry_id','journal_entries'),
      ('inventory_count_adjustments','inventory_transaction_id','inventory_transactions'),
      ('inventory_count_adjustments','journal_entry_id','journal_entries'),
      ('inventory_count_adjustments','product_id','products'),
      ('inventory_purchase_reversals','original_purchase_transaction_id','inventory_transactions'),
      ('inventory_purchase_reversals','reversal_inventory_transaction_id','inventory_transactions'),
      ('inventory_purchase_reversals','journal_entry_id','journal_entries'),
      ('inventory_transactions','product_id','products'),
      ('invoice_item_direct_costs','invoice_item_id','invoice_items'),
      ('invoice_item_direct_costs','journal_entry_id','journal_entries'),
      ('invoice_item_taxes','liability_account_id','chart_of_accounts'),
      ('invoice_item_taxes','invoice_item_id','invoice_items'),
      ('invoice_item_taxes','invoice_id','invoices'),
      ('invoice_item_taxes','tax_id','taxes'),
      ('invoice_items','invoice_id','invoices'),
      ('invoice_items','product_id','products'),
      ('invoice_taxes','liability_account_id','chart_of_accounts'),
      ('invoice_taxes','invoice_id','invoices'),
      ('invoice_taxes','tax_id','taxes'),
      ('invoices','customer_id','customers'),
      ('invoices','discount_id','discounts'),
      ('journal_lines','account_id','chart_of_accounts'),
      ('journal_lines','journal_entry_id','journal_entries'),
      ('operating_expense_payments','journal_entry_id','journal_entries'),
      ('operating_expense_payments','operating_expense_id','operating_expenses'),
      ('operating_expense_refunds','journal_entry_id','journal_entries'),
      ('operating_expense_refunds','operating_expense_id','operating_expenses'),
      ('operating_expense_reversals','journal_entry_id','journal_entries'),
      ('operating_expense_reversals','operating_expense_id','operating_expenses'),
      ('operating_expenses','expense_account_id','chart_of_accounts'),
      ('payment_clearing_settlements','clearing_account_id','chart_of_accounts'),
      ('payment_clearing_settlements','journal_entry_id','journal_entries'),
      ('payments','customer_id','customers'),
      ('payments','invoice_id','invoices'),
      ('petty_cash_expense_reversals','journal_entry_id','journal_entries'),
      ('petty_cash_expense_reversals','petty_cash_transaction_id','petty_cash_transactions'),
      ('product_price_history','product_id','products'),
      ('receipts','customer_id','customers'),
      ('receipts','invoice_id','invoices'),
      ('receipts','payment_id','payments'),
      ('taxes','liability_account_id','chart_of_accounts')
    ) AS relationships(child_table, child_column, parent_table)
  LOOP
    v_constraint_name := 'tenant_fk_' ||
      pg_catalog.substr(
        pg_catalog.md5(v_fk.child_table || '.' || v_fk.child_column || '.' || v_fk.parent_table),
        1, 16
      );

    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (business_id, %I) REFERENCES public.%I (business_id, id) NOT VALID',
      v_fk.child_table,
      v_constraint_name,
      v_fk.child_column,
      v_fk.parent_table
    );

    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I VALIDATE CONSTRAINT %I',
      v_fk.child_table,
      v_constraint_name
    );
  END LOOP;
END;
$tenant_relationships$;

-- Every composite foreign key needs a matching child-side index beginning
-- with business_id. The parent-side (business_id, id) unique indexes were
-- created in phase 1; these indexes prevent scans on parent delete/update and
-- support tenant-scoped joins.
DO $tenant_relationship_indexes$
DECLARE
  v_fk record;
  v_index_name text;
BEGIN
  FOR v_fk IN
    SELECT *
    FROM (VALUES

      ('chart_of_accounts','parent_id','chart_of_accounts'),
      ('credit_note_line_taxes','liability_account_id','chart_of_accounts'),
      ('credit_note_line_taxes','credit_note_line_id','credit_note_lines'),
      ('credit_note_line_taxes','source_invoice_item_tax_id','invoice_item_taxes'),
      ('credit_note_line_taxes','tax_id','taxes'),
      ('credit_note_lines','credit_note_id','credit_notes'),
      ('credit_note_lines','invoice_item_id','invoice_items'),
      ('credit_note_lines','product_id','products'),
      ('credit_notes','customer_id','customers'),
      ('credit_notes','invoice_id','invoices'),
      ('credit_notes','journal_entry_id','journal_entries'),
      ('customer_credit_applications','credit_note_id','credit_notes'),
      ('customer_credit_applications','applied_to_invoice_id','invoices'),
      ('customer_credit_applications','journal_entry_id','journal_entries'),
      ('customer_credit_refunds','credit_note_id','credit_notes'),
      ('customer_credit_refunds','journal_entry_id','journal_entries'),
      ('inventory_count_adjustments','inventory_transaction_id','inventory_transactions'),
      ('inventory_count_adjustments','journal_entry_id','journal_entries'),
      ('inventory_count_adjustments','product_id','products'),
      ('inventory_purchase_reversals','original_purchase_transaction_id','inventory_transactions'),
      ('inventory_purchase_reversals','reversal_inventory_transaction_id','inventory_transactions'),
      ('inventory_purchase_reversals','journal_entry_id','journal_entries'),
      ('inventory_transactions','product_id','products'),
      ('invoice_item_direct_costs','invoice_item_id','invoice_items'),
      ('invoice_item_direct_costs','journal_entry_id','journal_entries'),
      ('invoice_item_taxes','liability_account_id','chart_of_accounts'),
      ('invoice_item_taxes','invoice_item_id','invoice_items'),
      ('invoice_item_taxes','invoice_id','invoices'),
      ('invoice_item_taxes','tax_id','taxes'),
      ('invoice_items','invoice_id','invoices'),
      ('invoice_items','product_id','products'),
      ('invoice_taxes','liability_account_id','chart_of_accounts'),
      ('invoice_taxes','invoice_id','invoices'),
      ('invoice_taxes','tax_id','taxes'),
      ('invoices','customer_id','customers'),
      ('invoices','discount_id','discounts'),
      ('journal_lines','account_id','chart_of_accounts'),
      ('journal_lines','journal_entry_id','journal_entries'),
      ('operating_expense_payments','journal_entry_id','journal_entries'),
      ('operating_expense_payments','operating_expense_id','operating_expenses'),
      ('operating_expense_refunds','journal_entry_id','journal_entries'),
      ('operating_expense_refunds','operating_expense_id','operating_expenses'),
      ('operating_expense_reversals','journal_entry_id','journal_entries'),
      ('operating_expense_reversals','operating_expense_id','operating_expenses'),
      ('operating_expenses','expense_account_id','chart_of_accounts'),
      ('payment_clearing_settlements','clearing_account_id','chart_of_accounts'),
      ('payment_clearing_settlements','journal_entry_id','journal_entries'),
      ('payments','customer_id','customers'),
      ('payments','invoice_id','invoices'),
      ('petty_cash_expense_reversals','journal_entry_id','journal_entries'),
      ('petty_cash_expense_reversals','petty_cash_transaction_id','petty_cash_transactions'),
      ('product_price_history','product_id','products'),
      ('receipts','customer_id','customers'),
      ('receipts','invoice_id','invoices'),
      ('receipts','payment_id','payments'),
      ('taxes','liability_account_id','chart_of_accounts')
    ) AS relationships(child_table, child_column, parent_table)
  LOOP
    v_index_name := 'tenant_ix_' ||
      pg_catalog.substr(
        pg_catalog.md5(v_fk.child_table || '.' || v_fk.child_column || '.' || v_fk.parent_table),
        1, 16
      );

    EXECUTE pg_catalog.format(
      'CREATE INDEX %I ON public.%I (business_id, %I)',
      v_index_name,
      v_fk.child_table,
      v_fk.child_column
    );
  END LOOP;
END;
$tenant_relationship_indexes$;

NOTIFY pgrst, 'reload schema';
