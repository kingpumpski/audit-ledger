CREATE OR REPLACE FUNCTION public.assign_user_role(target_user uuid, role_name app_role, granted_by_user uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.role() <> 'service_role' THEN
      IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
        RAISE EXCEPTION 'Not authorized to assign roles';
      END IF;
      granted_by_user := auth.uid();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = target_user AND role = role_name) THEN
        INSERT INTO public.user_roles (id, user_id, role, granted_by, granted_at)
        VALUES (gen_random_uuid(), target_user, role_name, granted_by_user, now());
        INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, new_data)
        VALUES (granted_by_user, 'create', 'user_roles', target_user, jsonb_build_object('role', role_name));
    END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.assign_user_role(uuid, app_role, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_user_role(uuid, app_role, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = _user_id AND role = _role
    )
    AND (
      auth.uid() IS NULL OR _user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role IN ('admin','auditor'))
    )
$function$;

CREATE OR REPLACE FUNCTION public.get_next_sequence(seq_name text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
    result TEXT;
    seq RECORD;
BEGIN
    IF auth.role() <> 'service_role' AND NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','accountant','cashier')
    ) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
    IF seq_name NOT IN ('invoice','receipt','payment','customer','product','journal','account') THEN
      RAISE EXCEPTION 'Invalid sequence name: %', seq_name;
    END IF;
    UPDATE public.sequences SET current_value = current_value + 1, updated_at = now()
    WHERE name = seq_name RETURNING prefix, current_value, padding INTO seq;
    IF seq.prefix IS NULL THEN
      RAISE EXCEPTION 'Sequence not found: %', seq_name;
    END IF;
    result := seq.prefix || LPAD(seq.current_value::TEXT, seq.padding, '0');
    RETURN result;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_next_sequence(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_sequence(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.count_recent_reset_requests(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_reset_failure(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_reset_lockout(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_recent_reset_requests(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_reset_failure(text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_reset_lockout(text, text) TO service_role;

DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

DROP POLICY IF EXISTS "Authenticated users can insert own audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert own audit logs" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Anyone signed in can read policy" ON public.password_policy;
CREATE POLICY "Staff can read policy" ON public.password_policy
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS private.cron_tokens (name text PRIMARY KEY, token text NOT NULL);
REVOKE ALL ON private.cron_tokens FROM PUBLIC, anon, authenticated;
INSERT INTO private.cron_tokens (name, token)
VALUES ('overdue', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.verify_cron_token(_name text, _token text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM private.cron_tokens WHERE name = _name AND token = _token) $$;
REVOKE EXECUTE ON FUNCTION public.verify_cron_token(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_token(text, text) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('check-overdue-invoices-daily');
EXCEPTION WHEN others THEN NULL;
END $$;
SELECT cron.schedule('check-overdue-invoices-daily', '0 8 * * *', $cron$
  SELECT net.http_post(
    url := 'https://ktlywndiwowgyftiwcqd.supabase.co/functions/v1/check-overdue-invoices',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token',(SELECT token FROM private.cron_tokens WHERE name='overdue')),
    body := '{}'::jsonb
  );
$cron$);