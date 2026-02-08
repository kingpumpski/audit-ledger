-- Security hardening: Block anonymous access to all sensitive tables
-- Drop existing policies that may allow anonymous access and recreate with proper authentication checks

-- 1. PROFILES: Tighten access
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Authenticated admins can view all profiles" 
ON public.profiles FOR SELECT 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view own profile" 
ON public.profiles FOR SELECT 
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Authenticated users can update own profile" 
ON public.profiles FOR UPDATE 
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 2. CUSTOMERS: Require authentication
DROP POLICY IF EXISTS "Employees can view customers" ON public.customers;
DROP POLICY IF EXISTS "Admins and accountants can manage customers" ON public.customers;

CREATE POLICY "Authenticated employees can view customers" 
ON public.customers FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));

CREATE POLICY "Authenticated admins and accountants can manage customers" 
ON public.customers FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

-- 3. INVOICES: Require authentication
DROP POLICY IF EXISTS "Employees can view invoices" ON public.invoices;
DROP POLICY IF EXISTS "Admins and accountants can manage invoices" ON public.invoices;

CREATE POLICY "Authenticated employees can view invoices" 
ON public.invoices FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));

CREATE POLICY "Authenticated admins and accountants can manage invoices" 
ON public.invoices FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

-- 4. RECEIPTS: Require authentication
DROP POLICY IF EXISTS "Employees can view receipts" ON public.receipts;
DROP POLICY IF EXISTS "Admins can void receipts" ON public.receipts;

CREATE POLICY "Authenticated employees can view receipts" 
ON public.receipts FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));

CREATE POLICY "Authenticated admins can manage receipts" 
ON public.receipts FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

-- 5. PAYMENTS: Require authentication
DROP POLICY IF EXISTS "Employees can view payments" ON public.payments;
DROP POLICY IF EXISTS "Admins accountants cashiers manage payments" ON public.payments;

CREATE POLICY "Authenticated employees can view payments" 
ON public.payments FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));

CREATE POLICY "Authenticated admins accountants cashiers manage payments" 
ON public.payments FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

-- 6. PRODUCTS: Require authentication
DROP POLICY IF EXISTS "Employees can view products" ON public.products;
DROP POLICY IF EXISTS "Admins accountants manage products" ON public.products;

CREATE POLICY "Authenticated employees can view products" 
ON public.products FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));

CREATE POLICY "Authenticated admins accountants manage products" 
ON public.products FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

-- 7. COMPANY_SETTINGS: Require authentication
DROP POLICY IF EXISTS "Employees can view company settings" ON public.company_settings;
DROP POLICY IF EXISTS "Admins can manage company settings" ON public.company_settings;

CREATE POLICY "Authenticated employees can view company settings" 
ON public.company_settings FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));

CREATE POLICY "Authenticated admins can manage company settings" 
ON public.company_settings FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 8. AUDIT_LOGS: Require authentication
DROP POLICY IF EXISTS "Admins and auditors can view audit logs" ON public.audit_logs;

CREATE POLICY "Authenticated admins and auditors can view audit logs" 
ON public.audit_logs FOR SELECT 
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'auditor'));

-- 9. TAXES: Require authentication
DROP POLICY IF EXISTS "Employees can view taxes" ON public.taxes;
DROP POLICY IF EXISTS "Admins can manage taxes" ON public.taxes;

CREATE POLICY "Authenticated employees can view taxes" 
ON public.taxes FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));

CREATE POLICY "Authenticated admins can manage taxes" 
ON public.taxes FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 10. DISCOUNTS: Require authentication
DROP POLICY IF EXISTS "Employees can view discounts" ON public.discounts;
DROP POLICY IF EXISTS "Admins accountants manage discounts" ON public.discounts;

CREATE POLICY "Authenticated employees can view discounts" 
ON public.discounts FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));

CREATE POLICY "Authenticated admins accountants manage discounts" 
ON public.discounts FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

-- 11. INVOICE_ITEMS: Require authentication
DROP POLICY IF EXISTS "Employees can view invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Admins accountants cashiers manage invoice items" ON public.invoice_items;

CREATE POLICY "Authenticated employees can view invoice items" 
ON public.invoice_items FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));

CREATE POLICY "Authenticated admins accountants cashiers manage invoice items" 
ON public.invoice_items FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

-- 12. INVOICE_TAXES: Require authentication
DROP POLICY IF EXISTS "Employees can view invoice taxes" ON public.invoice_taxes;
DROP POLICY IF EXISTS "Admins accountants manage invoice taxes" ON public.invoice_taxes;

CREATE POLICY "Authenticated employees can view invoice taxes" 
ON public.invoice_taxes FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));

CREATE POLICY "Authenticated admins accountants manage invoice taxes" 
ON public.invoice_taxes FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'));

-- 13. SEQUENCES: Require authentication
DROP POLICY IF EXISTS "Admins accountants cashiers can manage sequences" ON public.sequences;

CREATE POLICY "Authenticated admins accountants cashiers can manage sequences" 
ON public.sequences FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') OR public.has_role(auth.uid(), 'cashier'));

-- 14. PRODUCT_PRICE_HISTORY: Require authentication
DROP POLICY IF EXISTS "Employees can view price history" ON public.product_price_history;

CREATE POLICY "Authenticated employees can view price history" 
ON public.product_price_history FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));

-- 15. USER_ROLES: Tighten access
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "First user can claim admin" ON public.user_roles;

CREATE POLICY "Authenticated users can view own roles" 
ON public.user_roles FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated admins can manage roles" 
ON public.user_roles FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- First user claim policy (only when no roles exist)
CREATE POLICY "First user can claim admin" 
ON public.user_roles FOR INSERT 
TO authenticated
WITH CHECK (NOT EXISTS (SELECT 1 FROM public.user_roles));

-- 16. NOTIFICATIONS: Require authentication  
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Employees can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can insert own notifications" ON public.notifications;

CREATE POLICY "Authenticated users can view own notifications" 
ON public.notifications FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can update own notifications" 
ON public.notifications FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert own notifications" 
ON public.notifications FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 17. PERMISSIONS: Require authentication
DROP POLICY IF EXISTS "Admins can manage permissions" ON public.permissions;

CREATE POLICY "Authenticated admins can manage permissions" 
ON public.permissions FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view permissions" 
ON public.permissions FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));

-- 18. ROLE_PERMISSIONS: Require authentication
DROP POLICY IF EXISTS "Admins can manage role permissions" ON public.role_permissions;

CREATE POLICY "Authenticated admins can manage role permissions" 
ON public.role_permissions FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view role permissions" 
ON public.role_permissions FOR SELECT 
TO authenticated
USING (public.has_any_role(auth.uid()));