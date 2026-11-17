-- Default ACLs owned by Supabase's platform role cannot be altered by
-- the postgres migration role. Enforce the same anonymous-access boundary at
-- DDL time for future public-schema tables, views, sequences and functions,
-- regardless of which privileged migration role creates them.

CREATE OR REPLACE FUNCTION public.revoke_public_schema_anon_grants()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $revoke_public_schema_anon_grants$
DECLARE
  cmd record;
  object_schema name;
  object_name name;
  object_kind "char";
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_catalog.pg_event_trigger_ddl_commands()
    WHERE schema_name = 'public'
  LOOP
    IF cmd.object_type IN ('table', 'partitioned table', 'view', 'materialized view', 'foreign table') THEN
      SELECT n.nspname, c.relname, c.relkind
        INTO object_schema, object_name, object_kind
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.oid = cmd.objid;

      IF FOUND AND object_kind IN ('r', 'p', 'v', 'm', 'f') THEN
        EXECUTE pg_catalog.format(
          'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC, anon',
          object_schema,
          object_name
        );
      END IF;
    ELSIF cmd.object_type = 'sequence' THEN
      SELECT n.nspname, c.relname
        INTO object_schema, object_name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.oid = cmd.objid
        AND c.relkind = 'S';

      IF FOUND THEN
        EXECUTE pg_catalog.format(
          'REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM PUBLIC, anon',
          object_schema,
          object_name
        );
      END IF;
    ELSIF cmd.object_type = 'function' THEN
      EXECUTE pg_catalog.format(
        'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',
        cmd.objid::pg_catalog.regprocedure
      );
    END IF;
  END LOOP;
END;
$revoke_public_schema_anon_grants$;

REVOKE ALL ON FUNCTION public.revoke_public_schema_anon_grants()
  FROM PUBLIC, anon, authenticated, service_role;

DROP EVENT TRIGGER IF EXISTS secure_public_schema_object_grants;
CREATE EVENT TRIGGER secure_public_schema_object_grants
  ON ddl_command_end
  WHEN TAG IN (
    'CREATE TABLE',
    'CREATE TABLE AS',
    'SELECT INTO',
    'CREATE VIEW',
    'CREATE MATERIALIZED VIEW',
    'CREATE FOREIGN TABLE',
    'CREATE SEQUENCE',
    'CREATE FUNCTION'
  )
  EXECUTE FUNCTION public.revoke_public_schema_anon_grants();

NOTIFY pgrst, 'reload schema';
