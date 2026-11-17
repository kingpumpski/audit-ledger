-- The one-time administrator claim must happen only through the
-- authenticated, serialized SECURITY DEFINER RPC.
DROP POLICY IF EXISTS "First user can claim admin" ON public.user_roles;
NOTIFY pgrst, 'reload schema';
