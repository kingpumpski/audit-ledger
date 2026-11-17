-- Public-schema objects are for authenticated application users and trusted
-- backend services. Anonymous clients use Supabase Auth, not direct table/RPC
-- access. Remove inherited anon/PUBLIC privileges and prevent them returning
-- through the default ACLs used by the migration owner.

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

DROP POLICY IF EXISTS "Authenticated users can insert own audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert own audit logs"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins, accountants, and cashiers can create invoices" ON public.invoices;
CREATE POLICY "Admins, accountants, and cashiers can create invoices"
  ON public.invoices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'accountant'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'cashier'::public.app_role)
  );

DROP POLICY IF EXISTS "Authorized users can create payments" ON public.payments;
CREATE POLICY "Authorized users can create payments"
  ON public.payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'accountant'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'cashier'::public.app_role)
  );

DROP POLICY IF EXISTS "Admins can insert price history" ON public.product_price_history;
CREATE POLICY "Admins can insert price history"
  ON public.product_price_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'accountant'::public.app_role)
  );

NOTIFY pgrst, 'reload schema';
