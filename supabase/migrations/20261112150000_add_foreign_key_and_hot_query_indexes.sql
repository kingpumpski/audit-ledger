-- Cover foreign-key lookups and common list ordering/filter patterns.
-- CREATE INDEX IF NOT EXISTS makes this migration safe to replay.

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_created_by ON public.chart_of_accounts (created_by);
CREATE INDEX IF NOT EXISTS idx_customers_created_by ON public.customers (created_by);
CREATE INDEX IF NOT EXISTS idx_discounts_created_by ON public.discounts (created_by);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_product_id ON public.inventory_transactions (product_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON public.invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON public.invoice_items (product_id);
CREATE INDEX IF NOT EXISTS idx_invoice_taxes_invoice_id ON public.invoice_taxes (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_taxes_tax_id ON public.invoice_taxes (tax_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON public.invoices (created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_discount_id ON public.invoices (discount_id);
CREATE INDEX IF NOT EXISTS idx_invoices_issued_by ON public.invoices (issued_by);
CREATE INDEX IF NOT EXISTS idx_password_policy_updated_by ON public.password_policy (updated_by);
CREATE INDEX IF NOT EXISTS idx_payments_processed_by ON public.payments (processed_by);
CREATE INDEX IF NOT EXISTS idx_product_price_history_changed_by ON public.product_price_history (changed_by);
CREATE INDEX IF NOT EXISTS idx_product_price_history_product_id ON public.product_price_history (product_id);
CREATE INDEX IF NOT EXISTS idx_products_created_by ON public.products (created_by);
CREATE INDEX IF NOT EXISTS idx_receipts_invoice_id ON public.receipts (invoice_id);
CREATE INDEX IF NOT EXISTS idx_receipts_issued_by ON public.receipts (issued_by);
CREATE INDEX IF NOT EXISTS idx_receipts_payment_id ON public.receipts (payment_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON public.role_permissions (permission_id);
CREATE INDEX IF NOT EXISTS idx_taxes_created_by ON public.taxes (created_by);
CREATE INDEX IF NOT EXISTS idx_user_roles_granted_by ON public.user_roles (granted_by);

-- Match the application list queries that exclude soft-deleted records and
-- sort newest-first. Keep the indexes partial to avoid indexing archived rows.
CREATE INDEX IF NOT EXISTS idx_invoices_live_created_at
  ON public.invoices (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_live_created_at
  ON public.receipts (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_live_created_at
  ON public.payments (created_at DESC) WHERE deleted_at IS NULL;
