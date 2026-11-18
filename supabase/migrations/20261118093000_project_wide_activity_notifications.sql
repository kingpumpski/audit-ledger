-- Broadcast audited activity to the active members of the affected workspace.
-- Events without a business context are sent as generic project-wide updates so
-- they do not disclose another workspace's entity type or record details.

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

  IF v_row ? 'business_id'
     AND (v_row ->> 'business_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_business_id := (v_row ->> 'business_id')::uuid;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, user_email, action, entity_type, entity_id,
    old_data, new_data, ip_address, business_id
  )
  VALUES (
    auth.uid(),
    (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()),
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

-- Ensure all business-owned operational records emit audit events. Existing
-- audited tables are recreated with one AFTER trigger covering all mutations.
DO $audit_triggers$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name, t.tgname AS trigger_name
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgfoid = 'public.audit_trigger_func()'::regprocedure
      AND c.relname NOT IN ('audit_logs', 'notifications', 'sequences',
                            'business_members', 'password_history',
                            'password_reset_tokens', 'password_policy')
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname
          AND col.column_name = 'id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname
          AND col.column_name = 'business_id'
      )
  LOOP
    EXECUTE pg_catalog.format('DROP TRIGGER %I ON public.%I', r.trigger_name, r.table_name);
  END LOOP;

  FOR r IN
    SELECT DISTINCT t.table_name
    FROM information_schema.tables t
    JOIN information_schema.columns id_col
      ON id_col.table_schema = t.table_schema
      AND id_col.table_name = t.table_name
      AND id_col.column_name = 'id'
    JOIN information_schema.columns business_col
      ON business_col.table_schema = t.table_schema
      AND business_col.table_name = t.table_name
      AND business_col.column_name = 'business_id'
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND t.table_name NOT IN ('audit_logs', 'notifications', 'sequences',
                               'business_members', 'password_history',
                               'password_reset_tokens', 'password_policy')
  LOOP
    EXECUTE pg_catalog.format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      'audit_activity_' || r.table_name, r.table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I ' ||
      'FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func()',
      'audit_activity_' || r.table_name, r.table_name
    );
  END LOOP;
END;
$audit_triggers$;

-- Workspace creation is a project-level event and has no parent business_id.
DROP TRIGGER IF EXISTS audit_activity_businesses ON public.businesses;
CREATE TRIGGER audit_activity_businesses
AFTER INSERT OR UPDATE OR DELETE ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE OR REPLACE FUNCTION public.notify_members_of_audit_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $notify$
DECLARE
  v_business_id uuid;
  v_action text;
  v_entity_label text;
  v_title text;
  v_message text;
  v_link text;
BEGIN
  v_business_id := NEW.business_id;

  IF v_business_id IS NULL
     AND NEW.metadata ? 'business_id'
     AND (NEW.metadata ->> 'business_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_business_id := (NEW.metadata ->> 'business_id')::uuid;
  END IF;

  v_action := CASE NEW.action::text
    WHEN 'create' THEN 'created'
    WHEN 'update' THEN 'updated'
    WHEN 'delete' THEN 'deleted'
    WHEN 'login' THEN 'signed in'
    WHEN 'logout' THEN 'signed out'
    WHEN 'view' THEN 'viewed'
    WHEN 'export' THEN 'exported'
    WHEN 'sign' THEN 'signed'
    ELSE 'performed an action on'
  END;

  v_entity_label := pg_catalog.initcap(pg_catalog.replace(NEW.entity_type, '_', ' '));
  v_link := CASE NEW.entity_type
    WHEN 'invoices' THEN '/invoices'
    WHEN 'receipts' THEN '/receipts'
    WHEN 'customers' THEN '/customers'
    WHEN 'products' THEN '/products'
    WHEN 'operating_expenses' THEN '/accounting'
    WHEN 'journal_entries' THEN '/accounting'
    ELSE '/notifications'
  END;

  IF v_business_id IS NOT NULL THEN
    v_title := v_entity_label || ' ' || v_action;
    v_message := COALESCE(NEW.user_email, 'A team member') || ' ' ||
      v_action || ' a ' || pg_catalog.lower(v_entity_label) || ' record.';
    INSERT INTO public.notifications (user_id, business_id, title, message, type, link)
    SELECT DISTINCT bm.user_id, v_business_id, v_title, v_message, 'project_activity', v_link
    FROM public.business_members bm
    WHERE bm.business_id = v_business_id
      AND bm.status = 'active';
  ELSIF NEW.entity_type IN ('user_roles', 'businesses') THEN
    -- Only trusted, global administrative events may fan out without a tenant.
    -- Sensitive authentication events and arbitrary client audit rows stay private.
    INSERT INTO public.notifications (user_id, business_id, title, message, type, link)
    SELECT DISTINCT bm.user_id, NULL::uuid, 'Project activity',
      'A project activity was recorded. Open the notification centre for details.',
      'project_activity', '/notifications'
    FROM public.business_members bm
    WHERE bm.status = 'active';
  END IF;

  RETURN NEW;
END;
$notify$;

REVOKE ALL ON FUNCTION public.notify_members_of_audit_activity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notify_members_after_audit_log_insert ON public.audit_logs;
CREATE TRIGGER notify_members_after_audit_log_insert
AFTER INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.notify_members_of_audit_activity();

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can insert own notifications" ON public.notifications;

-- Client-created audit rows must belong to the caller's active workspace.
-- Global events are emitted by trusted database triggers or service-role functions.
DROP POLICY IF EXISTS "Authenticated users can insert own audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert own audit logs"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND business_id IS NOT NULL
    AND business_id = (SELECT public.current_business_id())
  );

GRANT SELECT, UPDATE ON public.notifications TO authenticated;

-- Normalize legacy rows so the unread counter has one unambiguous state.
UPDATE public.notifications SET is_read = false WHERE is_read IS NULL;
ALTER TABLE public.notifications ALTER COLUMN is_read SET DEFAULT false;
ALTER TABLE public.notifications ALTER COLUMN is_read SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created_at
  ON public.notifications (user_id, created_at DESC)
  WHERE is_read IS NOT TRUE;

DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'notifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
  ELSE
    CREATE PUBLICATION supabase_realtime FOR TABLE public.notifications;
  END IF;
END;
$publication$;

NOTIFY pgrst, 'reload schema';
