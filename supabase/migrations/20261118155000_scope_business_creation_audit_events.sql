-- Business rows are the tenant root and do not have a business_id column.
-- Attribute their audit events to their own id so tenant RLS and notification
-- fan-out do not misclassify business-specific events as project-wide activity.
-- This runs after 20261118154000, whose audit_logs policy permits the trusted
-- SECURITY DEFINER trigger owner to record a new business before membership
-- creation completes.
CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $audit$
DECLARE
  v_row jsonb;
  v_old_data jsonb;
  v_new_data jsonb;
  v_business_id uuid;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN pg_catalog.to_jsonb(OLD) ELSE pg_catalog.to_jsonb(NEW) END;
  v_old_data := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN pg_catalog.to_jsonb(OLD) ELSE NULL END;
  v_new_data := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN pg_catalog.to_jsonb(NEW) ELSE NULL END;

  IF TG_TABLE_NAME = 'businesses' THEN
    -- A business row is the tenant root; its own id is the business context.
    -- The creator may not have a membership row yet, so the trusted trigger
    -- owner and audit_logs tenant policy must permit this initial audit event.
    v_business_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF v_row ? 'business_id' THEN
    BEGIN
      v_business_id := NULLIF(v_row ->> 'business_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_business_id := NULL;
    END;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, user_email, action, entity_type, entity_id,
    old_data, new_data, ip_address, business_id
  )
  VALUES (
    auth.uid(),
    public.rpc_auth_user_email(auth.uid()),
    CASE TG_OP
      WHEN 'INSERT' THEN 'create'::public.audit_action
      WHEN 'UPDATE' THEN 'update'::public.audit_action
      WHEN 'DELETE' THEN 'delete'::public.audit_action
      ELSE NULL
    END,
    TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    v_old_data,
    v_new_data,
    NULL,
    v_business_id
  );

  RETURN COALESCE(NEW, OLD);
END;
$audit$;

-- The user_roles table already has an audit trigger. Remove the duplicate
-- manual audit insert from this RPC so each role change produces one event.
