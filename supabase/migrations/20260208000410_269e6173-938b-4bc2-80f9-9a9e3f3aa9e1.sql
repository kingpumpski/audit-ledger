-- Add explicit DENY policies for anonymous role to all sensitive tables
-- This provides belt-and-suspenders security alongside the existing authenticated policies

-- Revoke any default permissions from anon role on all tables
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.customers FROM anon;
REVOKE ALL ON public.invoices FROM anon;
REVOKE ALL ON public.invoice_items FROM anon;
REVOKE ALL ON public.invoice_taxes FROM anon;
REVOKE ALL ON public.receipts FROM anon;
REVOKE ALL ON public.payments FROM anon;
REVOKE ALL ON public.products FROM anon;
REVOKE ALL ON public.product_price_history FROM anon;
REVOKE ALL ON public.company_settings FROM anon;
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE ALL ON public.taxes FROM anon;
REVOKE ALL ON public.discounts FROM anon;
REVOKE ALL ON public.sequences FROM anon;
REVOKE ALL ON public.user_roles FROM anon;
REVOKE ALL ON public.notifications FROM anon;
REVOKE ALL ON public.permissions FROM anon;
REVOKE ALL ON public.role_permissions FROM anon;

-- Grant necessary SELECT to authenticated role (to ensure policies can work)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_taxes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT ON public.product_price_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_settings TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.taxes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discounts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sequences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;