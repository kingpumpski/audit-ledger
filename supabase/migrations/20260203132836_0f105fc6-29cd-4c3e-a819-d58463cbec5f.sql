-- Fix RLS policies to require authenticated role explicitly
-- This migration updates all policies to use 'authenticated' role instead of allowing anonymous access

-- Drop and recreate policies for public.profiles
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Drop and recreate policies for public.user_roles
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;

CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Drop and recreate policies for public.notifications
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;

CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Drop and recreate policies for public.audit_logs
DROP POLICY IF EXISTS "Admins and auditors can view audit logs" ON public.audit_logs;

CREATE POLICY "Admins and auditors can view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'auditor'));

-- Drop and recreate policies for public.company_settings
DROP POLICY IF EXISTS "Admins can manage company settings" ON public.company_settings;
DROP POLICY IF EXISTS "Employees can view company settings" ON public.company_settings;

CREATE POLICY "Admins can manage company settings" ON public.company_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Employees can view company settings" ON public.company_settings
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'cashier', 'auditor']));

-- Drop and recreate policies for public.customers
DROP POLICY IF EXISTS "Admins and accountants can manage customers" ON public.customers;
DROP POLICY IF EXISTS "Employees can view customers" ON public.customers;

CREATE POLICY "Admins and accountants can manage customers" ON public.customers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Employees can view customers" ON public.customers
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'cashier', 'auditor']));

-- Drop and recreate policies for public.products
DROP POLICY IF EXISTS "Admins accountants manage products" ON public.products;
DROP POLICY IF EXISTS "Employees can view products" ON public.products;

CREATE POLICY "Admins accountants manage products" ON public.products
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Employees can view products" ON public.products
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'cashier', 'auditor']));

-- Drop and recreate policies for public.invoices
DROP POLICY IF EXISTS "Admins and accountants can manage invoices" ON public.invoices;
DROP POLICY IF EXISTS "Employees can view invoices" ON public.invoices;

CREATE POLICY "Admins and accountants can manage invoices" ON public.invoices
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

CREATE POLICY "Employees can view invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'cashier', 'auditor']));

-- Drop and recreate policies for public.invoice_items
DROP POLICY IF EXISTS "Admins accountants cashiers manage invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Employees can view invoice items" ON public.invoice_items;

CREATE POLICY "Admins accountants cashiers manage invoice items" ON public.invoice_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

CREATE POLICY "Employees can view invoice items" ON public.invoice_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'cashier', 'auditor']));

-- Drop and recreate policies for public.payments
DROP POLICY IF EXISTS "Admins accountants cashiers manage payments" ON public.payments;
DROP POLICY IF EXISTS "Employees can view payments" ON public.payments;

CREATE POLICY "Admins accountants cashiers manage payments" ON public.payments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

CREATE POLICY "Employees can view payments" ON public.payments
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'cashier', 'auditor']));

-- Drop and recreate policies for public.receipts
DROP POLICY IF EXISTS "Admins can void receipts" ON public.receipts;
DROP POLICY IF EXISTS "Employees can view receipts" ON public.receipts;
DROP POLICY IF EXISTS "Cashiers can create receipts" ON public.receipts;

CREATE POLICY "Admins can void receipts" ON public.receipts
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Cashiers can create receipts" ON public.receipts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

CREATE POLICY "Employees can view receipts" ON public.receipts
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'cashier', 'auditor']));

-- Drop and recreate policies for public.taxes
DROP POLICY IF EXISTS "Admins can manage taxes" ON public.taxes;
DROP POLICY IF EXISTS "Employees can view taxes" ON public.taxes;

CREATE POLICY "Admins can manage taxes" ON public.taxes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Employees can view taxes" ON public.taxes
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'cashier', 'auditor']));

-- Drop and recreate policies for public.discounts
DROP POLICY IF EXISTS "Admins accountants manage discounts" ON public.discounts;
DROP POLICY IF EXISTS "Employees can view discounts" ON public.discounts;

CREATE POLICY "Admins accountants manage discounts" ON public.discounts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Employees can view discounts" ON public.discounts
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'cashier', 'auditor']));

-- Drop and recreate policies for public.sequences
DROP POLICY IF EXISTS "Admins accountants can manage sequences" ON public.sequences;

CREATE POLICY "Admins accountants cashiers can manage sequences" ON public.sequences
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

-- Drop and recreate policies for public.invoice_taxes
DROP POLICY IF EXISTS "Admins accountants manage invoice taxes" ON public.invoice_taxes;
DROP POLICY IF EXISTS "Employees can view invoice taxes" ON public.invoice_taxes;

CREATE POLICY "Admins accountants manage invoice taxes" ON public.invoice_taxes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

CREATE POLICY "Employees can view invoice taxes" ON public.invoice_taxes
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'cashier', 'auditor']));

-- Drop and recreate policies for public.product_price_history
DROP POLICY IF EXISTS "Employees can view price history" ON public.product_price_history;

CREATE POLICY "Employees can view price history" ON public.product_price_history
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin', 'accountant', 'cashier', 'auditor']));

-- Drop and recreate policies for public.permissions
DROP POLICY IF EXISTS "Admins can manage permissions" ON public.permissions;
DROP POLICY IF EXISTS "Admins can view permissions" ON public.permissions;

CREATE POLICY "Admins can manage permissions" ON public.permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Drop and recreate policies for public.role_permissions
DROP POLICY IF EXISTS "Admins can manage role permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "Admins can view role permissions" ON public.role_permissions;

CREATE POLICY "Admins can manage role permissions" ON public.role_permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Update storage policies
DROP POLICY IF EXISTS "Admins can delete company assets" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update company assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read company assets" ON storage.objects;

CREATE POLICY "Authenticated users can read company assets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'company-assets');

CREATE POLICY "Admins can update company assets" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'company-assets' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete company assets" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'company-assets' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert company assets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-assets' AND public.has_role(auth.uid(), 'admin'));