-- Security Hardening Migration
-- Fix anonymous access by requiring authenticated role in all policies

-- ==========================================
-- 1. UPDATE RLS POLICIES TO REQUIRE AUTHENTICATION
-- ==========================================

-- Drop existing policies that allow anonymous access and recreate with proper restrictions

-- PROFILES TABLE
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- USER_ROLES TABLE
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "No deletes allowed on user roles" ON public.user_roles;
DROP POLICY IF EXISTS "No updates allowed on user roles" ON public.user_roles;

CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- CUSTOMERS TABLE
DROP POLICY IF EXISTS "Employees can view customers" ON public.customers;
DROP POLICY IF EXISTS "Admins and accountants can manage customers" ON public.customers;

CREATE POLICY "Employees can view customers" ON public.customers
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins and accountants can manage customers" ON public.customers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

-- INVOICES TABLE
DROP POLICY IF EXISTS "Employees can view invoices" ON public.invoices;
DROP POLICY IF EXISTS "Admins and accountants can update unlocked invoices" ON public.invoices;

CREATE POLICY "Employees can view invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins and accountants can manage invoices" ON public.invoices
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

-- INVOICE_ITEMS TABLE
DROP POLICY IF EXISTS "Employees can view invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Admins, accountants, and cashiers can manage invoice items" ON public.invoice_items;

CREATE POLICY "Employees can view invoice items" ON public.invoice_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins accountants cashiers manage invoice items" ON public.invoice_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

-- INVOICE_TAXES TABLE
DROP POLICY IF EXISTS "Employees can view invoice taxes" ON public.invoice_taxes;
DROP POLICY IF EXISTS "Admins and accountants can manage invoice taxes" ON public.invoice_taxes;

CREATE POLICY "Employees can view invoice taxes" ON public.invoice_taxes
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins accountants manage invoice taxes" ON public.invoice_taxes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

-- PAYMENTS TABLE
DROP POLICY IF EXISTS "Employees can view payments" ON public.payments;

CREATE POLICY "Employees can view payments" ON public.payments
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins accountants cashiers manage payments" ON public.payments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

-- RECEIPTS TABLE
DROP POLICY IF EXISTS "Employees can view receipts" ON public.receipts;
DROP POLICY IF EXISTS "Admins can void receipts" ON public.receipts;

CREATE POLICY "Employees can view receipts" ON public.receipts
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins accountants cashiers create receipts" ON public.receipts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

CREATE POLICY "Admins can void receipts" ON public.receipts
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- PRODUCTS TABLE
DROP POLICY IF EXISTS "Employees can view products" ON public.products;
DROP POLICY IF EXISTS "Admins and accountants can manage products" ON public.products;

CREATE POLICY "Employees can view products" ON public.products
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins accountants manage products" ON public.products
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

-- PRODUCT_PRICE_HISTORY TABLE
DROP POLICY IF EXISTS "Employees can view price history" ON public.product_price_history;

CREATE POLICY "Employees can view price history" ON public.product_price_history
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

-- TAXES TABLE
DROP POLICY IF EXISTS "Employees can view taxes" ON public.taxes;
DROP POLICY IF EXISTS "Admins can manage taxes" ON public.taxes;

CREATE POLICY "Employees can view taxes" ON public.taxes
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins can manage taxes" ON public.taxes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- DISCOUNTS TABLE
DROP POLICY IF EXISTS "Employees can view discounts" ON public.discounts;
DROP POLICY IF EXISTS "Admins and accountants can manage discounts" ON public.discounts;

CREATE POLICY "Employees can view discounts" ON public.discounts
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins accountants manage discounts" ON public.discounts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

-- COMPANY_SETTINGS TABLE
DROP POLICY IF EXISTS "Admins can view company settings" ON public.company_settings;
DROP POLICY IF EXISTS "Admins can update company settings" ON public.company_settings;

CREATE POLICY "Employees can view company settings" ON public.company_settings
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins can manage company settings" ON public.company_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- NOTIFICATIONS TABLE
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;

CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can create notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- AUDIT_LOGS TABLE
DROP POLICY IF EXISTS "Admins and auditors can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Auditors can read audit logs" ON public.audit_logs;

CREATE POLICY "Admins and auditors can view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'auditor'));

-- PERMISSIONS TABLE
DROP POLICY IF EXISTS "Authenticated users can view permissions" ON public.permissions;
DROP POLICY IF EXISTS "Admins can manage permissions" ON public.permissions;

CREATE POLICY "Admins can view permissions" ON public.permissions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage permissions" ON public.permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ROLE_PERMISSIONS TABLE
DROP POLICY IF EXISTS "Authenticated users can view role permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "Admins can manage role permissions" ON public.role_permissions;

CREATE POLICY "Admins can view role permissions" ON public.role_permissions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage role permissions" ON public.role_permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- SEQUENCES TABLE
DROP POLICY IF EXISTS "Employees can use sequences" ON public.sequences;

CREATE POLICY "Admins accountants can manage sequences" ON public.sequences
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

-- ==========================================
-- 2. UPDATE SECURITY DEFINER FUNCTIONS
-- ==========================================

-- Ensure all security definer functions have proper search_path
CREATE OR REPLACE FUNCTION public.assign_user_role(target_user uuid, role_name app_role, granted_by_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = target_user AND role = role_name
    ) THEN
        INSERT INTO public.user_roles (id, user_id, role, granted_by, granted_at)
        VALUES (gen_random_uuid(), target_user, role_name, granted_by_user, now());

        INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, new_data)
        VALUES (
            granted_by_user,
            'create',
            'user_roles',
            target_user,
            jsonb_build_object('role', role_name)
        );
    END IF;
END;
$$;