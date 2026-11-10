-- Normalize PostgreSQL trigger operation names before writing audit actions.
-- TG_OP returns INSERT/UPDATE/DELETE, while public.audit_action stores
-- create/update/delete. This migration must precede the chart-of-accounts
-- seed migration that fires the audit trigger.
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
    lower(TG_OP)::public.audit_action,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    NULL
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;
