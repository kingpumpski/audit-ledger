-- Harden every authenticated SECURITY DEFINER RPC that still used
-- search_path=public. All application objects referenced by these routines are
-- schema-qualified, so an empty search path preserves behavior and prevents
-- object-shadowing surprises as the schema evolves.

ALTER FUNCTION public.assign_user_role(uuid, public.app_role, uuid)
  SET search_path = '';
ALTER FUNCTION public.claim_initial_admin()
  SET search_path = '';
ALTER FUNCTION public.get_next_sequence(text)
  SET search_path = '';
ALTER FUNCTION public.get_user_role(uuid)
  SET search_path = '';
ALTER FUNCTION public.has_any_role(text[])
  SET search_path = '';
ALTER FUNCTION public.has_any_role(uuid)
  SET search_path = '';
ALTER FUNCTION public.has_permission(text)
  SET search_path = '';
ALTER FUNCTION public.has_permission(text, uuid)
  SET search_path = '';
ALTER FUNCTION public.has_role(public.app_role)
  SET search_path = '';
ALTER FUNCTION public.has_role(uuid, public.app_role)
  SET search_path = '';
ALTER FUNCTION public.is_first_user()
  SET search_path = '';
ALTER FUNCTION public.void_receipt_and_reconcile(uuid)
  SET search_path = '';

NOTIFY pgrst, 'reload schema';
