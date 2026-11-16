-- The one-time administrator claim must happen only through the
-- authenticated, serialized SECURITY DEFINER RPC. A permissive direct INSERT
-- policy on user_roles lets a caller race or bypass that guarded workflow.
DROP POLICY IF EXISTS "First user can claim admin" ON public.user_roles;

NOTIFY pgrst, 'reload schema';
