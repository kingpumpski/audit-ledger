-- Event-trigger functions are invoked by PostgreSQL's DDL event-trigger machinery,
-- not by application clients. Never expose this SECURITY DEFINER function as an RPC.
REVOKE ALL ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC, anon, authenticated, service_role;
