-- Allow cashiers to create tax snapshots for invoices they are already permitted to create.
-- Existing admin/accountant ALL-policy remains unchanged.
CREATE POLICY "Authenticated admins accountants and cashiers can create invoice taxes"
ON public.invoice_taxes
FOR INSERT
TO authenticated
WITH CHECK (
  has_role((SELECT auth.uid()), 'admin'::app_role)
  OR has_role((SELECT auth.uid()), 'accountant'::app_role)
  OR has_role((SELECT auth.uid()), 'cashier'::app_role)
);
