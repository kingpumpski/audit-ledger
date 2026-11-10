-- Add audit trigger for automatic audit log generation on key tables
CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (
    user_id,
    user_email,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data,
    ip_address
  )
  VALUES (
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    TG_OP::audit_action,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    NULL
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create triggers for automatic audit logging
CREATE TRIGGER audit_invoices_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_receipts_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.receipts
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_payments_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_customers_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_products_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_user_roles_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Add function to check if user is the first user (for initial admin setup)
CREATE OR REPLACE FUNCTION public.is_first_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles)
$$;

-- Add function to assign initial admin role (only works for first user)
CREATE OR REPLACE FUNCTION public.claim_initial_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  -- Only allow if no roles exist yet
  IF EXISTS (SELECT 1 FROM public.user_roles) THEN
    RETURN false;
  END IF;
  
  -- Assign admin role to current user
  INSERT INTO public.user_roles (user_id, role, granted_by)
  VALUES (current_user_id, 'admin', current_user_id);
  
  RETURN true;
END;
$$;

-- Create view for admin to see all users with their roles
CREATE OR REPLACE VIEW public.users_with_roles AS
SELECT 
  p.id,
  p.email,
  p.full_name,
  p.phone,
  p.avatar_url,
  p.job_title,
  p.department,
  p.is_active,
  p.created_at,
  COALESCE(
    (SELECT array_agg(ur.role ORDER BY ur.granted_at) 
     FROM public.user_roles ur 
     WHERE ur.user_id = p.id),
    ARRAY[]::app_role[]
  ) as roles
FROM public.profiles p;

-- Grant access to the view for authenticated users
GRANT SELECT ON public.users_with_roles TO authenticated;

-- Add signature_hash column to receipts for verification
ALTER TABLE public.receipts 
ADD COLUMN IF NOT EXISTS signature_hash text;

-- Add soft delete support - ensure deleted_at exists on key tables
ALTER TABLE public.receipts 
ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.payments 
ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Update RLS to exclude soft-deleted records
DROP POLICY IF EXISTS "Employees can view receipts" ON public.receipts;
CREATE POLICY "Employees can view receipts" 
ON public.receipts 
FOR SELECT 
USING (has_any_role(auth.uid()) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Employees can view payments" ON public.payments;
CREATE POLICY "Employees can view payments" 
ON public.payments 
FOR SELECT 
USING (has_any_role(auth.uid()) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Employees can view invoices" ON public.invoices;
CREATE POLICY "Employees can view invoices" 
ON public.invoices 
FOR SELECT 
USING (has_any_role(auth.uid()) AND deleted_at IS NULL);

-- Add void policy for receipts (soft delete)
CREATE POLICY "Admins can void receipts"
ON public.receipts
FOR UPDATE
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Ensure invoices cannot be modified once locked
DROP POLICY IF EXISTS "Admins and accountants can update invoices" ON public.invoices;
CREATE POLICY "Admins and accountants can update unlocked invoices" 
ON public.invoices 
FOR UPDATE
USING (
  (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')) 
  AND is_locked = false
  AND deleted_at IS NULL
);

-- Enable realtime for audit_logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;