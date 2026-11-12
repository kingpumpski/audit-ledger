-- Restrict direct API execution of SECURITY DEFINER functions that are
-- implementation details (trigger handlers) or server-side password-reset helpers.
-- Trigger execution continues through the triggers already attached to their tables.
REVOKE ALL ON FUNCTION public.audit_trigger_func() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.products_set_sku_if_missing() FROM PUBLIC, anon, authenticated;

-- Password-reset lockout helpers are called by trusted server-side functions only.
REVOKE ALL ON FUNCTION public.count_recent_reset_requests(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_reset_failure(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_reset_lockout(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_reset_locked(text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.count_recent_reset_requests(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_reset_failure(text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_reset_lockout(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_reset_locked(text, text) TO service_role;
