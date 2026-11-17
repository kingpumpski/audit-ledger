-- Cover every remaining public-schema foreign key with a matching
-- leading-column index. These indexes support joins and prevent parent-row
-- updates/deletes from requiring full child-table scans.

CREATE INDEX IF NOT EXISTS idx_credit_note_line_taxes_liability_account_id
  ON public.credit_note_line_taxes (liability_account_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_line_taxes_source_invoice_item_tax_id
  ON public.credit_note_line_taxes (source_invoice_item_tax_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_line_taxes_tax_id
  ON public.credit_note_line_taxes (tax_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_lines_product_id
  ON public.credit_note_lines (product_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_created_by
  ON public.credit_notes (created_by);
CREATE INDEX IF NOT EXISTS idx_customer_credit_applications_applied_to_invoice_id
  ON public.customer_credit_applications (applied_to_invoice_id);
CREATE INDEX IF NOT EXISTS idx_customer_credit_applications_created_by
  ON public.customer_credit_applications (created_by);
CREATE INDEX IF NOT EXISTS idx_customer_credit_refunds_created_by
  ON public.customer_credit_refunds (created_by);
CREATE INDEX IF NOT EXISTS idx_financial_completeness_attestations_attested_by
  ON public.financial_completeness_attestations (attested_by);
CREATE INDEX IF NOT EXISTS idx_inventory_count_adjustments_recorded_by
  ON public.inventory_count_adjustments (recorded_by);
CREATE INDEX IF NOT EXISTS idx_inventory_purchase_reversals_recorded_by
  ON public.inventory_purchase_reversals (recorded_by);
CREATE INDEX IF NOT EXISTS idx_invoice_item_direct_costs_recorded_by
  ON public.invoice_item_direct_costs (recorded_by);
CREATE INDEX IF NOT EXISTS idx_invoice_item_taxes_liability_account_id
  ON public.invoice_item_taxes (liability_account_id);
CREATE INDEX IF NOT EXISTS idx_invoice_item_taxes_tax_id
  ON public.invoice_item_taxes (tax_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_cost_verified_by
  ON public.invoice_items (cost_verified_by);
CREATE INDEX IF NOT EXISTS idx_operating_expense_payments_recorded_by
  ON public.operating_expense_payments (recorded_by);
CREATE INDEX IF NOT EXISTS idx_operating_expense_refunds_recorded_by
  ON public.operating_expense_refunds (recorded_by);
CREATE INDEX IF NOT EXISTS idx_operating_expense_reversals_recorded_by
  ON public.operating_expense_reversals (recorded_by);
CREATE INDEX IF NOT EXISTS idx_operating_expenses_expense_account_id
  ON public.operating_expenses (expense_account_id);
CREATE INDEX IF NOT EXISTS idx_operating_expenses_recorded_by
  ON public.operating_expenses (recorded_by);
CREATE INDEX IF NOT EXISTS idx_payment_clearing_settlements_created_by
  ON public.payment_clearing_settlements (created_by);
CREATE INDEX IF NOT EXISTS idx_petty_cash_expense_reversals_recorded_by
  ON public.petty_cash_expense_reversals (recorded_by);
