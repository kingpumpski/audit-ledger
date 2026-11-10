-- Map PostgreSQL trigger operations to the application's audit_action enum.
-- TG_OP returns INSERT/UPDATE/DELETE, while audit_action uses
-- create/update/delete. Preserve the original audit function's schema and behavior.
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
    CASE TG_OP
      WHEN 'INSERT' THEN 'create'::public.audit_action
      WHEN 'UPDATE' THEN 'update'::public.audit_action
      WHEN 'DELETE' THEN 'delete'::public.audit_action
      ELSE NULL
    END,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    NULL
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;
